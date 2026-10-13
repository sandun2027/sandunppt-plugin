"""User-owned provider settings. Secrets are protected with Windows DPAPI, never bundled."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

DEFAULTS = {
    "text": {"base_url": "https://api.openai.com/v1", "model": "gpt-5.6-luna"},
    "image": {"base_url": "https://api.openai.com/v1", "model": "gpt-image-2.5-sunburst"},
}


class ConfigError(ValueError):
    pass


def normalize_url(value: str) -> str:
    value = value.strip().rstrip("/")
    for suffix in ("/chat/completions", "/images/generations", "/images/edits"):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ConfigError("接口地址必须是 HTTP(S) 地址，不含账号、密码或查询参数")
    if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ConfigError("非本机接口请使用 HTTPS")
    if not parsed.path or parsed.path == "/":
        value += "/v1"
    return value


class DPAPI:
    """Current Windows user scope; no plaintext fallback."""

    @staticmethod
    def _crypt(value: bytes, decrypt: bool) -> bytes:
        if os.name != "nt":
            raise ConfigError("保存 API Key 需要 Windows 凭据保护")
        from ctypes import wintypes

        class Blob(ctypes.Structure):
            _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]

        buffer = ctypes.create_string_buffer(value)
        source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
        target = Blob()
        fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
        if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
            raise ConfigError("无法读取或保护 API Key，请重新填写配置")
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            ctypes.windll.kernel32.LocalFree(target.data)

    def encrypt(self, value: str) -> str:
        return base64.b64encode(self._crypt(value.encode(), False)).decode()

    def decrypt(self, value: str) -> str:
        return self._crypt(base64.b64decode(value), True).decode()


class ProviderConfig:
    def __init__(self, directory: Path, cipher=None):
        self.path = directory / "providers.json"
        self.cipher = cipher or DPAPI()
        self.lock = threading.RLock()

    def _load(self) -> dict:
        if not self.path.exists():
            return {k: dict(v, encrypted_key="") for k, v in DEFAULTS.items()}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            raise ConfigError("配置文件无法读取，请检查本地配置文件") from None

    def public(self) -> dict:
        with self.lock:
            data = self._load()
            return {
                k: {
                    "base_url": data[k]["base_url"],
                    "model": data[k]["model"],
                    "key_configured": bool(data[k].get("encrypted_key")),
                }
                for k in DEFAULTS
            }

    def resolve(self, kind: str, override: dict | None = None) -> dict:
        if kind not in DEFAULTS:
            raise ConfigError("未知模型配置类型")
        with self.lock:
            saved = self._load()[kind]
            patch = override or {}
            url = normalize_url(str(patch.get("base_url", saved["base_url"])))
            model = str(patch.get("model", saved["model"])).strip()
            if not model or len(model) > 200:
                raise ConfigError("请填写有效的模型名称")
            key = str(patch.get("api_key") or "").strip()
            if patch.get("clear_key"):
                key = ""
            elif not key and url == saved["base_url"] and saved.get("encrypted_key"):
                key = self.cipher.decrypt(saved["encrypted_key"])
            if any(c in key for c in "\r\n") or len(key) > 4096:
                raise ConfigError("API Key 格式不正确")
            return {"base_url": url, "model": model, "api_key": key}

    def save(self, payload: dict) -> dict:
        with self.lock:
            data = self._load()
            for kind in DEFAULTS:
                if kind not in payload:
                    continue
                if not isinstance(payload[kind], dict):
                    raise ConfigError("配置格式不正确")
                value = self.resolve(kind, payload[kind])
                key = value.pop("api_key")
                data[kind] = dict(value, encrypted_key=self.cipher.encrypt(key) if key else "")
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp, self.path)
            return self.public()
