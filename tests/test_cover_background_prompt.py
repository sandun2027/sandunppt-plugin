import json

import httpx
import pytest

from ppagent_local.cover_background_prompt import COVER_BACKGROUND_RULES, build_cover_background_prompt

SVG = '<svg viewBox="0 0 1280 720"><g id="title" transform="translate(30,10)"><text x="700" y="200" font-size="80">动态主题</text></g><g id="subtitle"><text x="700" y="400">动态副标题</text></g></svg>'


@pytest.mark.parametrize("topic", ["盒马：重新定义鲜活生活", "海洋科学：探索深蓝"])
def test_dynamic_topic_and_full_geometry(topic):
    result = build_cover_background_prompt(topic, "苔绿色；标题色 #24352B", SVG)
    assert result.count(SVG) == 1
    assert topic in result and "#24352B" in result
    assert "不可见的后期文字占位参考" in result
    assert "不得沿字形轮廓留白" in result
    assert "不固定在左侧或右侧" in result
    assert "不能叠加 SVG 前景" in result
    if topic.startswith("海洋"):
        assert "盒马" not in result


def test_open_image_request_uses_contract_and_keeps_svg():
    import base64
    import io

    from PIL import Image

    from ppagent_local.open_ai import OpenAIService

    class Config:
        def resolve(self, kind, override=None):
            return {"base_url": "https://image.example.test/v1", "api_key": "fixture-key", "model": "fixture"}

    calls = []
    data = io.BytesIO()
    Image.new("RGB", (32, 18), "white").save(data, format="PNG")

    def handler(request):
        calls.append(json.loads(request.content))
        assert request.url.path == "/v1/images/generations"
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(data.getvalue()).decode()}]})

    service = OpenAIService(Config(), httpx.Client(transport=httpx.MockTransport(handler)))
    result = service.run("cover/background", {"title": "动态主题", "draft_svg": SVG, "style_description": "自然清新"})
    assert result["success"]
    assert len(calls) == 1 and SVG in calls[0]["prompt"]
    assert COVER_BACKGROUND_RULES in calls[0]["prompt"]
    service.run("generate-image", {"prompt": "普通图片"})
    assert calls[1]["prompt"] == "普通图片"

