import base64
import io
import json
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from ppagent_local.app import create_app
from ppagent_local.config import Settings
from ppagent_local.open_ai import AIError, COMPLEX, SIMPLE, OpenAIService, sanitize_svg
from ppagent_local.provider_config import ConfigError, DPAPI, ProviderConfig


class TestCipher:
    __test__ = False

    def encrypt(self, value):
        return base64.b64encode(value.encode()).decode()

    def decrypt(self, value):
        return base64.b64decode(value).decode()


@pytest.fixture
def config(tmp_path):
    store = ProviderConfig(tmp_path, TestCipher())
    store.save(
        {
            kind: {
                "api_key": "test-placeholder",
                "base_url": f"https://{kind}.example.test/v1",
                "model": f"test-{kind}",
            }
            for kind in ["text", "image"]
        }
    )
    return store


def reply(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def png():
    data = io.BytesIO()
    Image.new("RGB", (64, 64), "#2563eb").save(data, format="PNG")
    return base64.b64encode(data.getvalue()).decode()


def test_defaults_and_secret_lifecycle(tmp_path):
    store = ProviderConfig(tmp_path, TestCipher())
    defaults = store.public()
    assert defaults["text"]["model"] == "gpt-5.6-luna"
    assert defaults["image"]["model"] == "gpt-image-2.5-sunburst"
    assert not defaults["text"]["key_configured"]
    saved = store.save({"text": {"api_key": "test-placeholder"}})
    assert saved["text"]["key_configured"]
    assert "test-placeholder" not in json.dumps(saved)
    assert "test-placeholder" not in store.path.read_text()
    store.save({"text": {"model": "changed", "api_key": ""}})
    assert store.resolve("text")["api_key"] == "test-placeholder"
    # Never forward a saved credential to a new provider address.
    assert store.resolve("text", {"base_url": "https://other.example.test/v1"})["api_key"] == ""
    store.save({"text": {"clear_key": True}})
    assert not store.public()["text"]["key_configured"]


@pytest.mark.skipif(os.name != "nt", reason="Windows DPAPI")
def test_real_windows_secret_protection(tmp_path):
    store = ProviderConfig(tmp_path)
    store.save({"text": {"api_key": "test-placeholder"}})
    assert ProviderConfig(tmp_path).resolve("text")["api_key"] == "test-placeholder"
    assert "test-placeholder" not in store.path.read_text()


@pytest.mark.parametrize(
    "url",
    [
        "http://remote.example.test/v1",
        "https://user:password@example.test/v1",
        "https://example.test?key=bad",
        "file:///tmp/x",
    ],
)
def test_invalid_addresses(config, url):
    with pytest.raises(ConfigError):
        config.resolve("text", {"base_url": url})


@pytest.mark.parametrize("kind", sorted(COMPLEX | SIMPLE | {"auto"}))
def test_diagram_types_and_counted_mother(config, kind):
    calls = []
    ai = None

    def transport(request):
        assert request.url.host == "text.example.test"
        data = json.loads(request.content)
        assert data["model"] == "test-text"
        assert request.headers["authorization"] == "Bearer test-placeholder"
        content = data["messages"][-1]["content"]
        calls.append(content)
        if "用户指定类型=" in content:
            family = "progression" if kind == "auto" else kind
            mother = next(
                m
                for m in ai.gallery
                if m["family"] == family
                and (not m.get("supported_node_counts") or 3 in m["supported_node_counts"])
            )
            return reply(
                json.dumps(
                    {
                        "diagram_type": family,
                        "style_ref_id": mother["id"],
                        "node_count": 3,
                        "content_spec": "需求、设计、交付",
                    },
                    ensure_ascii=False,
                )
            )
        return reply(
            '<svg viewBox="0 0 800 400"><g id="steps"><text x="20" y="60">需求、设计、交付</text></g></svg>'
        )

    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(transport)))
    result = ai.run("generate-diagram", {"prompt": "需求、设计、交付", "diagram_type": kind})
    slot = result["slot"]
    assert result["success"] and "需求" in slot["svg"]
    assert slot["width"] == 800 and slot["height"] == 400
    assert slot["diagram_type"] == ("progression" if kind == "auto" else kind)
    if kind in SIMPLE or kind == "auto":
        assert len(calls) == 2 and "完整参考 SVG" in calls[1]
        assert slot["style_ref_id"] and slot["node_count"] == 3


def test_invalid_mother_never_silently_falls_back(config):
    ai = OpenAIService(
        config,
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _: reply('{"diagram_type":"cycle","style_ref_id":"missing"}')
            )
        ),
    )
    with pytest.raises(AIError, match="选型"):
        ai.diagram("需求流程", "auto")


def test_svg_retry_and_error(config):
    count = 0

    def transport(_):
        nonlocal count
        count += 1
        return reply("not svg" if count == 1 else "<svg><text>有效</text></svg>")

    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(transport)))
    assert "有效" in ai.diagram("流程", "flowchart")["slot"]["svg"]
    assert count == 2


@pytest.mark.parametrize(
    "raw",
    [
        "<svg><script>alert(1)</script></svg>",
        "<svg><foreignObject/></svg>",
        '<svg><use href="https://example.test/x"/></svg>',
        '<svg viewBox="0 0 NaN 2"></svg>',
        '<svg><rect style="fill:url(https://example.test/x)"/></svg>',
    ],
)
def test_svg_rejects_unsafe_content(raw):
    with pytest.raises(AIError):
        sanitize_svg(raw)


def test_generation_and_connectivity_use_separate_providers(config):
    calls = []

    def transport(request):
        data = json.loads(request.content)
        calls.append((request.url.host, request.url.path, data["model"]))
        if request.url.path.endswith("images/generations"):
            return httpx.Response(200, json={"data": [{"b64_json": png()}]})
        return reply("OK")

    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(transport)))
    assert ai.check("text", {})["success"]
    assert ai.check("image", {})["success"]
    assert ai.run("generate-image", {"prompt": "蓝色圆形"})["url"].startswith("data:image/png;base64,")
    assert calls == [
        ("text.example.test", "/v1/chat/completions", "test-text"),
        ("image.example.test", "/v1/images/generations", "test-image"),
        ("image.example.test", "/v1/images/generations", "test-image"),
    ]


def test_upstream_errors_do_not_expose_keys(config):
    ai = OpenAIService(
        config,
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(401, json={"error": "test-placeholder"}))
        ),
    )
    with pytest.raises(AIError) as err:
        ai.chat("test", "hello")
    assert "test-placeholder" not in str(err.value)


def test_cover_and_chart_contracts(config):
    plan = dict(
        main_title="测试主题",
        subtitle="副标题",
        style_name="简洁",
        style_description="蓝白色",
        background_type="light",
        primary_color="#ffffff",
        secondary_color="#f1f5f9",
        accent_color="#2563eb",
        title_color="#0f172a",
        subtitle_color="#475569",
    )

    def transport(request):
        body = json.loads(request.content)
        if request.url.path.endswith("images/generations"):
            assert "严禁" in body["prompt"] and "title" in body["prompt"]
            return httpx.Response(200, json={"data": [{"b64_json": png()}]})
        content = body["messages"][-1]["content"]
        if "chart_slots" in content:
            return reply('{"chart_slots":[{"chart_type":"bar","data":[{"label":"A","value":2}]}]}')
        if "JSON 数组" in content:
            return reply(json.dumps([plan] * 4))
        return reply(
            '<svg viewBox="0 0 1280 720"><g id="title"><text x="60" y="180">测试主题</text></g></svg>'
        )

    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(transport)))
    assert len(ai.run("cover/plan", {"topic": "测试主题"})["plans"]) == 4
    draft = ai.run("cover/draft", {"title": "测试主题", "position": "left-middle"})["svg"]
    assert 'id="title"' in draft
    assert ai.run("cover/background", {"title": "测试主题", "draft_svg": draft})["url"].startswith("data:")
    assert json.loads(ai.run("generate-chart", {"prompt": "数据"})["chart_data"])["chart_slots"]


def test_local_api_security_and_removed_business_endpoints(tmp_path, config):
    settings = Settings(
        host="127.0.0.1",
        port=17667,
        data_dir=tmp_path,
        static_dir=Path(__file__).parents[1] / "src/ppagent_local/static",
        dev_origin=None,
        secure_cookies=False,
    )
    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(lambda _: reply("OK"))))
    with TestClient(create_app(settings, provider_config=config, ai_service=ai)) as client:
        assert client.get("/local/config").status_code == 403
        boot = client.get("/local/bootstrap").json()
        client.headers.update({"X-PPTagent-Client": "taskpane-v1", "X-PPTagent-CSRF": boot["csrfToken"]})
        assert client.get("/local/config").status_code == 200
        assert client.post("/local/config/test/text", json={}).json()["success"]
        for path in ["/local/projects", "/local/session", "/local/website/session", "/api/projects/list"]:
            assert client.get(path).status_code == 404
        assert (
            client.put(
                "/local/config",
                json={"text": {"model": "new"}},
                headers={"Origin": "https://evil.example.test"},
            ).status_code
            == 403
        )
        response = client.put("/local/config", json={"text": {"model": "changed"}})
        assert response.status_code == 200 and "test-placeholder" not in response.text
