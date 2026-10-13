import base64
import io
import json
from email import policy
from email.parser import BytesParser
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from ppagent_local.app import create_app
from ppagent_local.config import Settings
from ppagent_local.image_options import image_parameters, reference_files, supports_image_options
from ppagent_local.open_ai import AIError, OpenAIService
from ppagent_local.provider_config import ConfigError, normalize_url


def picture(fmt="PNG"):
    data = io.BytesIO()
    Image.new("RGBA" if fmt != "JPEG" else "RGB", (48, 32)).save(data, format=fmt)
    return data.getvalue()


def reference(fmt="PNG"):
    return "data:image/" + {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[fmt] + ";base64," + base64.b64encode(picture(fmt)).decode()


class Config:
    def __init__(self, model="gpt-image-2.5-sunburst"):
        self.model = model

    def resolve(self, kind, override=None):
        return {"model": self.model, "base_url": "https://fixture.example.test/v1", "api_key": "fixture"}


@pytest.mark.parametrize("model", ["gpt-image-2.5-sunburst", "GPT-Image-2.5-Flare", "openai/gpt-image-2.5-flare", "gpt-image-2.5-sunburst-2026-09-08"])
def test_supported_model_detection(model):
    assert supports_image_options(model)


@pytest.mark.parametrize("model", ["gpt-image-1", "my-gpt-image-2.5-flare", "gpt-image-2.5-flare-fast", "flux", ""])
def test_other_models_do_not_enable_options(model):
    assert not supports_image_options(model)


@pytest.mark.parametrize("options", [
    {"size": "1536x865"}, {"size": "64x64"}, {"size": "4096x2048"}, {"size": "3072x768"},
    {"size": "3840x3840"}, {"size": []}, {"quality": "hd"}, {"quality": []},
    {"output_format": "svg"}, {"background": "transparent", "output_format": "jpeg"},
    {"output_compression": True, "output_format": "jpeg"}, {"output_compression": 101, "output_format": "jpeg"},
    {"output_compression": 90, "output_format": "png"}, {"unexpected": 1}, "bad",
])
def test_invalid_settings_rejected_before_provider(options):
    calls = []
    service = OpenAIService(Config(), httpx.Client(transport=httpx.MockTransport(lambda req: calls.append(req))))
    with pytest.raises(ConfigError):
        service.run("generate-image", {"prompt": "产品摄影", "image_options": options})
    assert calls == []


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_references_are_validated_and_preserved(fmt):
    files = reference_files([reference(fmt)])
    assert files[0][0] == "image[]"
    assert files[0][1][1] == picture(fmt)


@pytest.mark.parametrize("values", [
    ["https://example.test/image.png"], ["data:image/svg+xml;base64,PHN2Zz4="],
    ["data:image/png;base64,AAAA"], ["data:image/png;base64,broken"],
    [reference()] * 5, "invalid", [reference("JPEG").replace("image/jpeg", "image/png")],
    ["data:image/png;base64," + "A" * (8 * 1024 * 1024 * 4 // 3 + 129)],
])
def test_invalid_references_rejected(values):
    with pytest.raises(ConfigError):
        reference_files(values)


@pytest.mark.parametrize("model", ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])
def test_generation_and_multipart_edit_local_api(tmp_path, model):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["authorization"] == "Bearer fixture"
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(picture()).decode()}]})

    config = Config(model)
    ai = OpenAIService(config, httpx.Client(transport=httpx.MockTransport(handler)))
    settings = Settings(host="127.0.0.1", port=17667, data_dir=tmp_path, static_dir=Path(__file__).parents[1] / "src/ppagent_local/static", dev_origin=None, secure_cookies=False)
    options = {"size": "1536x864", "quality": "xhigh", "output_format": "png", "background": "transparent"}
    with TestClient(create_app(settings, provider_config=config, ai_service=ai)) as client:
        boot = client.get("/local/bootstrap").json()
        client.headers.update({"X-PPTagent-Client": "taskpane-v1", "X-PPTagent-CSRF": boot["csrfToken"]})
        payload = {"prompt": "保留参考主体，生成无字商品图片", "image_options": options}
        response = client.post("/local/plugin/ai/generate-image", json=payload)
        assert response.status_code == 200 and response.json()["url"].startswith("data:image/png;base64,")
        assert calls[0].url.path == "/v1/images/generations"
        assert json.loads(calls[0].content) == {"model": model, "prompt": payload["prompt"], "n": 1, **options}
        payload["reference_images"] = [reference("PNG"), reference("JPEG"), reference("WEBP"), reference("PNG")]
        assert client.post("/local/plugin/ai/generate-image", json=payload).status_code == 200
        edit = calls[1]
        assert edit.url.path == "/v1/images/edits"
        message = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + edit.headers["content-type"] + "\r\n\r\n").encode() + edit.content)
        parts = list(message.iter_parts())
        fields = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True).decode() for part in parts if not part.get_filename()}
        assert fields == {"model": model, "prompt": payload["prompt"], "n": "1", **options}
        uploads = [part for part in parts if part.get_filename()]
        assert len(uploads) == 4
        assert all(part.get_param("name", header="content-disposition") == "image[]" for part in uploads)
        assert uploads[1].get_payload(decode=True) == picture("JPEG")
        assert "input_fidelity" not in fields and "response_format" not in fields
        bad = client.post("/local/plugin/ai/generate-image", json={**payload, "image_options": {"size": "1x1"}})
        assert bad.status_code == 400 and len(calls) == 2


def test_other_models_and_cover_keep_existing_request():
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(picture()).decode()}]})
    ai = OpenAIService(Config("another-model"), httpx.Client(transport=httpx.MockTransport(handler)))
    ai.run("generate-image", {"prompt": "普通生图"})
    assert calls[0] == {"model": "another-model", "prompt": "普通生图", "n": 1, "size": "1536x1024"}
    with pytest.raises(ConfigError):
        ai.run("generate-image", {"prompt": "参考图", "reference_images": [reference()]})
    ai.run("cover/background", {"title": "新主题", "draft_svg": "<svg/>", "image_options": {"quality": "max"}})
    assert "quality" not in calls[1] and "只分析几何区域" in calls[1]["prompt"]


@pytest.mark.parametrize("status", [400, 401, 404, 413, 422, 429, 500])
def test_provider_errors_do_not_retry_or_drop_references(status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "private provider detail"}})
    ai = OpenAIService(Config(), httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(AIError) as exc:
        ai.run("generate-image", {"prompt": "参考图", "reference_images": [reference()]})
    assert len(calls) == 1 and calls[0].url.path.endswith("/images/edits")
    assert "private provider detail" not in str(exc.value)


def test_compression_and_endpoint_normalization():
    assert image_parameters({"output_format": "jpeg", "output_compression": 0})["output_compression"] == 0
    assert normalize_url("https://example.test/v1/images/edits") == "https://example.test/v1"
