from __future__ import annotations

import ipaddress
import secrets
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from .config import Settings

CLIENT_HEADER = "X-PPTagent-Client"
CSRF_HEADER = "X-PPTagent-CSRF"
CLIENT_ID = "taskpane-v1"
COOKIE_NAME = "ppagent_local_session"


@dataclass(slots=True)
class LocalBrowserSession:
    cookie_value: str
    csrf_token: str

    @classmethod
    def create(cls) -> LocalBrowserSession:
        return cls(cookie_value=secrets.token_urlsafe(32), csrf_token=secrets.token_urlsafe(32))

    def bootstrap(self, response: Response, *, secure: bool) -> dict[str, str]:
        response.set_cookie(
            COOKIE_NAME,
            self.cookie_value,
            secure=secure,
            httponly=True,
            samesite="strict",
            max_age=12 * 60 * 60,
            path="/",
        )
        response.headers["Cache-Control"] = "no-store"
        return {"clientId": CLIENT_ID, "csrfToken": self.csrf_token}

    def validate(self, request: Request, settings: Settings) -> JSONResponse | None:
        if settings.enforce_loopback and not is_loopback(request.client.host if request.client else ""):
            return denied("本地服务只接受回环地址请求")

        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in allowed_origins(settings):
            return denied("请求来源不受信任")

        if request.headers.get(CLIENT_HEADER) != CLIENT_ID:
            return denied("缺少本地插件客户端标识")
        if not secrets.compare_digest(request.cookies.get(COOKIE_NAME, ""), self.cookie_value):
            return denied("本地插件会话无效")

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            csrf = request.headers.get(CSRF_HEADER, "")
            if not secrets.compare_digest(csrf, self.csrf_token):
                return denied("本地插件安全校验失败")
            if request.method in {"POST", "PUT", "PATCH"}:
                content_type = request.headers.get("content-type", "")
                if not content_type.lower().startswith("application/json"):
                    return denied("写操作必须使用 JSON", status_code=415)
        return None


def is_loopback(host: str) -> bool:
    if host in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def allowed_origins(settings: Settings) -> set[str]:
    scheme = "https" if settings.tls_cert_file and settings.tls_key_file else "http"
    values = {
        f"{scheme}://127.0.0.1:{settings.port}",
        f"{scheme}://localhost:{settings.port}",
    }
    if settings.dev_origin:
        values.add(settings.dev_origin.rstrip("/"))
    return values


def denied(message: str, *, status_code: int = 403) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": message, "code": "local_security"})
