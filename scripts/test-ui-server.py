"""Local integration fixture. No real provider or user credentials are used."""
import base64
import io
import json
import os
from email import policy
from email.parser import BytesParser
from pathlib import Path

import httpx
import uvicorn
from PIL import Image

from ppagent_local.app import create_app
from ppagent_local.config import Settings
from ppagent_local.open_ai import OpenAIService
from ppagent_local.provider_config import ProviderConfig

root = Path(__file__).resolve().parents[1]
data_dir = root / ".work" / "ui-runtime"
store = ProviderConfig(data_dir)
image_requests = []


def provider(request):
    uploads = []
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        message = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + request.headers["content-type"] + "\r\n\r\n").encode() + request.content)
        data = {}
        for part in message.iter_parts():
            if part.get_filename():
                with Image.open(io.BytesIO(part.get_payload(decode=True))) as reference:
                    reference.verify()
                uploads.append(part.get_content_type())
            else:
                data[part.get_param("name", header="content-disposition")] = part.get_payload(decode=True).decode()
    else:
        data = json.loads(request.content)
    assert request.headers["authorization"] == "Bearer test-placeholder"
    if request.url.path.endswith(("images/generations", "images/edits")):
        image_requests.append({"path": request.url.path, "fields": data, "references": uploads})
        if data.get("prompt", "").startswith("[模拟失败]") and len([r for r in image_requests if r["fields"].get("prompt") == data["prompt"]]) == 1:
            return httpx.Response(429, json={"error": {"message": "fixture rate limit"}})
        transparent = data.get("background") == "transparent"
        im = Image.new("RGBA" if transparent else "RGB", (960, 540), (0, 0, 0, 0) if transparent else "#edf4ff")
        output = io.BytesIO()
        im.save(output, format="JPEG" if data.get("output_format") == "jpeg" else "PNG")
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(output.getvalue()).decode()}]})
    content = data["messages"][-1]["content"]
    if "用户指定类型=" in content:
        family = content.split("用户指定类型=")[1].split("（")[0]
        if family == "auto":
            family = "progression"
        mother = next(m for m in ai.gallery if m["family"] == family and 3 in m.get("supported_node_counts", []))
        result = json.dumps({"diagram_type": family, "style_ref_id": mother["id"], "node_count": 3, "content_spec": "需求确认、方案设计、交付验收"}, ensure_ascii=False)
    elif "chart_slots" in content:
        result = json.dumps({"chart_slots": [{"chart_type": "bar", "data": [{"label": "一季度", "value": 20}, {"label": "二季度", "value": 40}, {"label": "三季度", "value": 60}]}]}, ensure_ascii=False)
    elif "JSON 数组" in content:
        result = json.dumps([dict(main_title="面向未来的协作", subtitle="让每个想法清晰表达", style_name=name, style_description="蓝白配色，简洁清晰的视觉语言", background_type="light", primary_color="#ffffff", secondary_color="#f1f5f9", accent_color="#2563eb", title_color="#0f172a", subtitle_color="#475569") for name in ["清新蓝白", "自然浅绿", "现代暖灰", "明亮科技"]], ensure_ascii=False)
    elif "连通性测试" in content:
        result = "OK"
    elif "封面" in content:
        result = '<svg viewBox="0 0 1280 720"><g id="title"><text x="100" y="320" font-size="76" fill="#0f172a">面向未来的协作</text></g><g id="subtitle"><text x="100" y="395" font-size="30" fill="#475569">让每个想法清晰表达</text></g></svg>'
    else:
        result = '<svg viewBox="0 0 960 540"><rect x="50" y="210" width="240" height="120" rx="12" fill="#e7f0ff"/><rect x="360" y="210" width="240" height="120" rx="12" fill="#e7f0ff"/><rect x="670" y="210" width="240" height="120" rx="12" fill="#e7f0ff"/><g font-family="Microsoft YaHei" font-size="26" fill="#0f172a" text-anchor="middle"><text x="170" y="280">需求确认</text><text x="480" y="280">方案设计</text><text x="790" y="280">交付验收</text></g></svg>'
    return httpx.Response(200, json={"choices": [{"message": {"content": result}}]})


ai = OpenAIService(store, httpx.Client(transport=httpx.MockTransport(provider)))
settings = Settings(host="127.0.0.1", port=17767, data_dir=data_dir, static_dir=root / "src/ppagent_local/static", dev_origin=None, secure_cookies=False)
app = create_app(settings, provider_config=store, ai_service=ai)


@app.get("/fixture/image-requests")
def fixture_requests():
    return image_requests


app.router.routes.insert(0, app.router.routes.pop())
uvicorn.run(app, host="127.0.0.1", port=17767, access_log=False)
