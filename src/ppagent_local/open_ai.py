"""Standalone OpenAI-compatible AI tools, with bundled prompts and SVG mothers."""

from __future__ import annotations

import base64
import io
import ipaddress
import json
import math
import random
import re
import socket
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

import httpx
from defusedxml.ElementTree import fromstring
from PIL import Image

from .cover_background_prompt import build_cover_background_prompt
from .image_options import image_parameters, reference_files, supports_image_options
from .provider_config import ConfigError, ProviderConfig

PROMPTS = Path(__file__).with_name("prompts")
SIMPLE = {"timeline", "progression", "cycle", "containment", "comparison", "intersection", "converge-diverge"}
COMPLEX = {"flowchart", "architecture", "sequence", "ecosystem", "pyramid-funnel"}
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


class AIError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.txt").read_text(encoding="utf-8")


def fill(template: str, *values: str) -> str:
    for value in values:
        template = template.replace("%s", str(value), 1)
    return template.replace("%%", "%")


def parse_json(raw: str):
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        return json.loads(raw)
    except ValueError:
        raise AIError("模型未返回有效 JSON，请重试或更换文本模型") from None


def sanitize_svg(raw: str, width=960, height=540) -> tuple[str, float, float]:
    match = re.search(r"<svg\b[\s\S]*?</svg>", raw, re.I)
    if not match or len(raw) > 2_000_000:
        raise AIError("模型未返回完整 SVG")
    try:
        root = fromstring(match[0])
    except Exception:
        raise AIError("SVG 语法无效，请重新生成") from None
    allowed = {
        "svg",
        "g",
        "defs",
        "rect",
        "circle",
        "ellipse",
        "path",
        "polygon",
        "polyline",
        "line",
        "text",
        "tspan",
        "textPath",
        "linearGradient",
        "radialGradient",
        "stop",
        "clipPath",
        "mask",
        "marker",
        "pattern",
        "use",
        "title",
        "desc",
    }
    for element in root.iter():
        name = element.tag.split("}")[-1]
        if name not in allowed:
            raise AIError("SVG 含不支持的元素，请重新生成")
        element.tag = f"{{{SVG_NS}}}{name}"
        for key, value in list(element.attrib.items()):
            attr = key.split("}")[-1].lower()
            if attr.startswith("on") or attr in {"filter", "src"}:
                del element.attrib[key]
            elif attr == "href" and not value.startswith("#"):
                raise AIError("SVG 含外部资源，请重新生成")
            elif re.search(
                r"(?:javascript:|data:|https?:|@import|expression\s*\(|url\(\s*[^#])", value, re.I
            ):
                raise AIError("SVG 含外部资源或不安全样式")
        if name == "marker" and not element.get("orient"):
            element.set("orient", element.attrib.pop("orientation", "auto"))
    values = re.split(r"[\s,]+", root.get("viewBox", f"0 0 {width} {height}").strip())
    try:
        nums = [float(x) for x in values]
        if (
            len(nums) != 4
            or not all(math.isfinite(x) for x in nums)
            or not all(0 < x <= 20000 for x in nums[2:])
        ):
            raise ValueError()
    except ValueError:
        raise AIError("SVG 画布尺寸无效") from None
    root.set("viewBox", " ".join(f"{x:g}" for x in nums))
    root.attrib.pop("width", None)
    root.attrib.pop("height", None)
    svg = ET.tostring(root, encoding="unicode")
    prefix = "d" + uuid.uuid4().hex[:10] + "-"
    # Cover layers keep their semantic IDs for the native cover importer.
    ids = {e.get("id") for e in root.iter() if e.get("id") and e.get("id") not in {"title", "subtitle"}}
    for value in sorted(ids, key=len, reverse=True):
        svg = (
            svg.replace(f'id="{value}"', f'id="{prefix}{value}"')
            .replace(f"url(#{value})", f"url(#{prefix}{value})")
            .replace(f'href="#{value}"', f'href="#{prefix}{value}"')
        )
    return svg, nums[2], nums[3]


class OpenAIService:
    def __init__(self, config: ProviderConfig, client: httpx.Client | None = None):
        self.config = config
        self.client = client or httpx.Client(timeout=httpx.Timeout(180, connect=12), follow_redirects=False)
        self.gallery = json.loads((PROMPTS / "logic_gallery.json").read_text(encoding="utf-8"))
        self.groups = json.loads((PROMPTS / "logic_variant_groups.json").read_text(encoding="utf-8"))

    def close(self):
        self.client.close()

    def _post(self, cfg: dict, path: str, body: dict, *, files: list | None = None) -> dict:
        if not cfg["api_key"]:
            raise ConfigError("请先在配置中填写对应模型的 API Key")
        try:
            payload = {"data": {key: str(value) for key, value in body.items()}, "files": files} if files else {"json": body}
            response = self.client.post(
                cfg["base_url"] + path, headers={"Authorization": "Bearer " + cfg["api_key"]}, **payload
            )
        except httpx.TimeoutException:
            raise AIError("接口响应超时，请稍后重试", 504) from None
        except httpx.RequestError:
            raise AIError("无法连接接口，请检查地址和网络") from None
        if response.status_code >= 300:
            messages = {
                401: "API Key 无效或已过期",
                403: "当前 Key 无权使用该接口或模型",
                404: "接口路径或模型不存在，请检查配置",
                429: "接口额度不足或请求过于频繁",
                400: "图片参数或输入内容未被接口接受，请调整设置或参考图后重试" if path.startswith("/images/") else "接口未接受当前请求",
                413: "参考图过大，请减少图片数量或缩小文件",
                422: "接口不支持当前参数，请检查模型名称或调整图片设置",
            }
            raise AIError(
                messages.get(
                    response.status_code,
                    f"接口请求失败（HTTP {response.status_code}），请检查模型和接口兼容性",
                )
            )
        try:
            data = response.json()
        except ValueError:
            raise AIError("接口未返回 JSON，请检查接口地址") from None
        if not isinstance(data, dict) or data.get("error"):
            raise AIError("接口返回错误，请检查模型权限与账户额度")
        return data

    def chat(self, system: str, content: str, override: dict | None = None) -> str:
        cfg = self.config.resolve("text", override)
        data = self._post(
            cfg,
            "/chat/completions",
            {
                "model": cfg["model"],
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                "stream": False,
            },
        )
        try:
            result = data["choices"][0]["message"]["content"]
            if not isinstance(result, str) or not result.strip():
                raise ValueError()
            return result
        except (KeyError, IndexError, TypeError, ValueError):
            raise AIError("文本模型未返回有效内容") from None

    def _image_data(self, content: bytes) -> str:
        if not content or len(content) > 24 * 1024 * 1024:
            raise AIError("图片为空或超过 24 MB")
        try:
            with Image.open(io.BytesIO(content)) as im:
                if im.width * im.height > 40_000_000:
                    raise ValueError()
                fmt = im.format
                im.verify()
            mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[fmt]
        except Exception:
            raise AIError("接口未返回有效的 PNG、JPEG 或 WebP 图片") from None
        return "data:" + mime + ";base64," + base64.b64encode(content).decode()

    def _download_image(self, url: str) -> bytes:
        # Download provider-returned public images without forwarding the API Key.
        for _ in range(4):
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise AIError("图片下载地址无效")
            try:
                addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
                if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                    raise AIError("图片下载地址不是公开网络地址")
                with self.client.stream("GET", url, headers={"Authorization": ""}) as response:
                    if response.is_redirect:
                        from urllib.parse import urljoin

                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    response.raise_for_status()
                    chunks, size = [], 0
                    for part in response.iter_bytes():
                        size += len(part)
                        if size > 24 * 1024 * 1024:
                            raise AIError("生成的图片超过 24 MB")
                        chunks.append(part)
                    return b"".join(chunks)
            except (httpx.HTTPError, OSError):
                raise AIError("无法下载生成图片，请重试") from None
        raise AIError("图片下载重定向过多")

    def image(self, content: str, override: dict | None = None, test=False, *, options=None, references=None) -> dict:
        cfg = self.config.resolve("image", override)
        if (options is not None or references) and not supports_image_options(cfg["model"]):
            raise ConfigError("当前图片模型不支持这些图片设置或参考图，请重新打开 AI 生图刷新配置")
        parameters = image_parameters(options)
        files = reference_files(references)
        data = self._post(
            cfg,
            "/images/edits" if files else "/images/generations",
            {"model": cfg["model"], "prompt": content, "n": 1, "size": "1024x1024" if test else "1536x1024", **parameters},
            files=files,
        )
        try:
            item = data["data"][0]
            if item.get("b64_json"):
                raw = base64.b64decode(item["b64_json"], validate=True)
            else:
                raw = self._download_image(item["url"])
        except (KeyError, IndexError, TypeError, ValueError):
            raise AIError("图片接口未返回图像数据") from None
        return {"success": True, "url": self._image_data(raw)}

    def check(self, kind: str, override: dict) -> dict:
        if kind == "text":
            self.chat("请仅回复 OK。", "连通性测试", override)
        elif kind == "image":
            self.image(
                "A tiny blue circle centered on a plain white background, no text.", override, test=True
            )
        else:
            raise ConfigError("未知模型配置类型")
        return {"success": True, "message": "模型调用成功"}

    def svg(self, system: str, content: str, width=960, height=540):
        for attempt in range(2):
            raw = self.chat(system, content)
            try:
                return sanitize_svg(raw, width, height)
            except AIError as exc:
                if attempt:
                    raise
                content += f"\n上一次校验失败：{exc}。重新输出完整 SVG，保持全部事实、节点与母版布局。"

    def catalogue(self, family="") -> str:
        lines, seen = [], set()
        for m in self.gallery:
            if family and m["family"] != family:
                continue
            group = m.get("variant")
            if group and group in seen:
                continue
            seen.add(group)
            info = self.groups.get(group, m)
            counts = sorted(
                {
                    n
                    for x in self.gallery
                    if x["id"] == m["id"] or group and x.get("variant") == group
                    for n in x.get("supported_node_counts", [])
                }
            )
            lines.append(
                f"{m['id']} | {m['family']} | {info.get('use', '')} | {info.get('meaning', '')} | 支持节点数={counts}"
            )
        return prompt("logic-selection") + "\n" + "\n".join(lines)

    def diagram(self, content: str, kind="auto", title="") -> dict:
        if kind not in SIMPLE | COMPLEX | {"auto"}:
            raise ConfigError("不支持的图示类型")
        plan = {"diagram_type": kind, "content_spec": content}
        if kind == "auto" or kind in SIMPLE:
            system = '你是关系图选型专家。返回严格 JSON {"diagram_type":"类型","style_ref_id":"简单母版完整id","node_count":整数,"content_spec":"完整真实节点和关系"}。'
            instruction = f"用户指定类型={kind}（auto 时智能识别）。复杂分层/系统架构=architecture；带条件分支的流程=flowchart；角色消息交互=sequence；复杂生态网络=ecosystem；层级金字塔或漏斗=pyramid-funnel。简单关系优先使用简单图库。数量多不等于复杂关系。保留全部事实，不增删节点。\n用户描述：{content}\n{self.catalogue(kind if kind in SIMPLE else '')}"
            for attempt in range(2):
                plan = parse_json(self.chat(system, instruction))
                selected = plan.get("diagram_type") if isinstance(plan, dict) else None
                if selected in COMPLEX and kind == "auto":
                    kind = selected
                    break
                candidates = (
                    [
                        m
                        for m in self.gallery
                        if m["id"] == plan.get("style_ref_id") and m["family"] == selected
                    ]
                    if isinstance(plan, dict)
                    else []
                )
                if candidates and selected in SIMPLE and (kind == "auto" or kind == selected):
                    m = candidates[0]
                    count = plan.get("node_count", 0)
                    members = [
                        x
                        for x in self.gallery
                        if x["id"] == m["id"] or m.get("variant") and x.get("variant") == m["variant"]
                    ]
                    members = [
                        x
                        for x in members
                        if not x.get("supported_node_counts")
                        or isinstance(count, int)
                        and count in x["supported_node_counts"]
                    ]
                    if members:
                        mother = random.choice(members)
                        reference = mother.get("node_variants", {}).get(str(count), mother["svg"])
                        kind = selected
                        content = (
                            f"关系={kind}\n真实原文={content}\n节点定义={plan.get('content_spec', content)}\n节点数={count}\n目标母版={mother['id']}，适用={mother.get('use', '')}，含义={mother.get('meaning', '')}\n"
                            + prompt("logic-render")
                            + "\n完整参考 SVG：\n"
                            + reference
                        )
                        svg, width, height = self.svg(
                            "你是严格的 PPT 简单逻辑图 SVG 绘制引擎。只输出 SVG。", content
                        )
                        return {
                            "success": True,
                            "slot": {
                                "slot_id": "plugin-diagram-1",
                                "diagram_type": kind,
                                "style_ref_id": mother["id"],
                                "node_count": count,
                                "spec": plan.get("content_spec", ""),
                                "title": title,
                                "x": 0,
                                "y": 0,
                                "width": width,
                                "height": height,
                                "svg": svg,
                            },
                        }
                instruction += "\n上次选型无效。只能使用目录中的完整 id、对应关系与支持节点数，不能截断事实。"
                if attempt:
                    raise AIError("图示选型未匹配有效母版，请补充描述后重试")
        svg, width, height = self.svg(
            prompt("diagram"),
            f"图示类型={kind}\n主题仅作语义参考={title}\n完整内容与结构={content}\n画布=960×540；不新增图内主标题。",
        )
        return {
            "success": True,
            "slot": {
                "slot_id": "plugin-diagram-1",
                "diagram_type": kind,
                "title": title,
                "spec": content,
                "x": 0,
                "y": 0,
                "width": width,
                "height": height,
                "svg": svg,
            },
        }

    def run(self, operation: str, q: dict) -> dict:
        content = str(
            q.get(
                "topic"
                if operation in {"cover/plan", "cover/styles"}
                else "title"
                if operation.startswith("cover/")
                else "prompt",
                "",
            )
        ).strip()
        if not content or len(content) > 30000:
            raise ConfigError("请填写有效描述（不超过 30000 字）")
        if operation == "generate-image":
            return self.image(content, options=q.get("image_options"), references=q.get("reference_images"))
        if operation == "generate-diagram":
            return self.diagram(content, q.get("diagram_type") or "auto", str(q.get("title", "")))
        if operation == "generate-chart":
            raw = self.chat(
                "你只负责输出严格可解析的图表 JSON。",
                fill(prompt("chart"), content, q.get("chart_type") or "auto"),
            )
            data = parse_json(raw)
            slots = data.get("chart_slots") if isinstance(data, dict) else None
            if (
                not slots
                or not isinstance(slots, list)
                or not isinstance(slots[0], dict)
                or not slots[0].get("data")
            ):
                raise AIError("图表数据为空，请重新生成")
            return {"success": True, "chart_data": json.dumps(data, ensure_ascii=False)}
        if operation == "cover/plan":
            plans = parse_json(
                self.chat("你是 PPT 封面策划师，只输出 JSON。", fill(prompt("cover-plan"), content))
            )
            fields = {
                "main_title",
                "style_name",
                "style_description",
                "primary_color",
                "secondary_color",
                "accent_color",
                "title_color",
                "subtitle_color",
            }
            if (
                not isinstance(plans, list)
                or len(plans) != 4
                or any(
                    not isinstance(p, dict)
                    or any(not str(p.get(f, "")).strip() for f in fields)
                    or p.get("background_type") not in {"light", "dark"}
                    for p in plans
                )
            ):
                raise AIError("封面方案格式不完整，请重试")
            return {"success": True, "plans": plans}
        if operation == "cover/styles":
            styles = [
                s.strip()
                for s in self.chat(
                    "你是 PPT 视觉设计师。", fill(prompt("cover-styles"), content)
                ).splitlines()
                if s.strip()
            ]
            if len(styles) != 4:
                raise AIError("风格方案不足四组，请重试")
            return {"success": True, "styles": styles}
        if operation == "cover/draft":
            svg, _, _ = self.svg(
                "你是严格的 SVG 标题排版引擎。",
                fill(
                    prompt("cover-draft"),
                    content,
                    q.get("position", "left-middle"),
                    q.get("style_description", ""),
                ),
                1280,
                720,
            )
            return {"success": True, "svg": svg}
        if operation == "cover/background":
            content = build_cover_background_prompt(content, q.get("style_description", ""), q.get("draft_svg", ""))
            return self.image(content)
        raise ConfigError("不支持的 AI 操作")
