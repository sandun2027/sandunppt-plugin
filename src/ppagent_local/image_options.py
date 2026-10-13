"""Validated GPT Image controls for the standalone image tool."""

import base64
import binascii
import io
import re

from PIL import Image

from .provider_config import ConfigError

MAX_REFERENCES = 4
MAX_REFERENCE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 24 * 1024 * 1024


def supports_image_options(model: str) -> bool:
    name = model.strip().lower().split("/")[-1]
    return bool(re.fullmatch(r"gpt-image-2\.5-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?", name))


def image_parameters(value: dict | None) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError("图片设置格式不正确")
    allowed = {"size", "quality", "output_format", "background", "output_compression"}
    if set(value) - allowed:
        raise ConfigError("图片设置包含不支持的参数")
    result = dict(value)
    for key, choices in {
        "quality": {"auto", "low", "medium", "high", "xhigh", "max"},
        "output_format": {"png", "jpeg"},
        "background": {"auto", "opaque", "transparent"},
    }.items():
        if key in result and (not isinstance(result[key], str) or result[key] not in choices):
            raise ConfigError("图片画质、格式或背景设置无效")
    size = result.get("size", "auto")
    if size != "auto":
        if not isinstance(size, str) or not re.fullmatch(r"\d{3,4}x\d{3,4}", size):
            raise ConfigError("图片尺寸格式无效")
        width, height = map(int, size.split("x"))
        if (width % 16 or height % 16 or min(width, height) <= 0
                or max(width, height) > 3840 or max(width, height) > 3 * min(width, height)
                or not 655360 <= width * height <= 8294400):
            raise ConfigError("图片尺寸超出模型支持范围")
    if result.get("background") == "transparent" and result.get("output_format", "png") != "png":
        raise ConfigError("透明背景请使用 PNG 格式")
    if "output_compression" in result:
        compression = result["output_compression"]
        if type(compression) is not int or not 0 <= compression <= 100:
            raise ConfigError("图片压缩质量应为 0–100 的整数")
        if result.get("output_format") != "jpeg":
            raise ConfigError("仅 JPEG 图片支持压缩质量设置")
    return result


def reference_files(values: list | None) -> list:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > MAX_REFERENCES:
        raise ConfigError("最多添加 4 张参考图")
    files, total = [], 0
    for index, value in enumerate(values):
        if not isinstance(value, str) or len(value) > MAX_REFERENCE_BYTES * 4 // 3 + 128:
            raise ConfigError("单张参考图不能超过 8 MB")
        match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", value)
        if not match:
            raise ConfigError("参考图仅支持 PNG、JPEG 或 WebP")
        try:
            raw = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error):
            raise ConfigError("参考图数据无效，请重新选择") from None
        total += len(raw)
        if not raw or len(raw) > MAX_REFERENCE_BYTES or total > MAX_TOTAL_BYTES:
            raise ConfigError("单张参考图最多 8 MB，总大小不能超过 24 MB")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                expected = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[match[1]]
                if image.format != expected or image.width * image.height > 40_000_000:
                    raise ValueError()
                image.verify()
        except Exception:
            raise ConfigError("参考图损坏、格式不符或尺寸过大，请重新选择") from None
        files.append(("image[]", (f"reference-{index + 1}.{match[1]}", raw, "image/" + match[1])))
    return files
