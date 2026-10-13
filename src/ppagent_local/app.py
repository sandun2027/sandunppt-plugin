from __future__ import annotations

import subprocess
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import Settings
from .open_ai import AIError, OpenAIService
from .provider_config import ConfigError, ProviderConfig
from .security import LocalBrowserSession


def create_app(settings: Settings | None = None, *, provider_config=None, ai_service=None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.prepare()
    config = provider_config or ProviderConfig(settings.data_dir)
    ai = ai_service or OpenAIService(config)
    browser_session = LocalBrowserSession.create()

    @asynccontextmanager
    async def lifespan(_):
        yield
        ai.close()

    app = FastAPI(title="SANDUN PPT Open Source", version=__version__, lifespan=lifespan)
    app.state.config, app.state.ai = config, ai
    if settings.dev_origin:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[settings.dev_origin],
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT"],
            allow_headers=["Content-Type", "X-PPTagent-Client", "X-PPTagent-CSRF"],
        )

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.path.startswith("/local/") and request.url.path != "/local/bootstrap":
            rejection = browser_session.validate(request, settings)
            if rejection is not None:
                return rejection
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ConfigError)
    async def config_error(_, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(AIError)
    async def ai_error(_, exc):
        return JSONResponse(status_code=exc.status, content={"detail": str(exc)})

    @app.get("/healthz")
    def health():
        return {"status": "ok", "version": __version__, "edition": "open-source"}

    @app.get("/local/bootstrap")
    def bootstrap(response: Response):
        return browser_session.bootstrap(response, secure=settings.secure_cookies)

    @app.get("/local/config")
    def get_config():
        return config.public()

    @app.put("/local/config")
    def save_config(payload: dict):
        return config.save(payload)

    @app.post("/local/config/test/{kind}")
    def test_config(kind: str, payload: dict):
        return ai.check(kind, payload)

    @app.post("/local/plugin/ai/{operation:path}")
    def generate(operation: str, payload: dict):
        return ai.run(operation, payload)

    @app.post("/local/wps/tool")
    def wps_tool(tool: str = Query(..., min_length=1, max_length=64)) -> dict[str, Any]:
        """Invoke the registered WPS add-in outside WPS's broken JS COM wrapper."""
        if any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for ch in tool.lower()):
            raise HTTPException(status_code=400, detail="invalid tool")
        native_tools = {
            "zoom",
            "page-height",
            "guides",
            "master",
            "select-between",
            "select-inverse",
            "select-type",
            "select-font",
            "select-width",
            "select-height",
            "select-color",
            "layers",
            "select-lines",
            "select-text",
            "select-groups",
            "unify-fonts",
            "super-brush",
            "group-near",
            "group",
            "ungroup-style",
            "ungroup-slide",
            "ungroup-selection",
            "layer-up",
            "layer-down",
            "duplicate",
            "fill-slide",
            "crop-slide",
            "trim",
            "mask",
            "merge",
            "round-corners",
            "collage",
            "export-images",
            "export-fonts",
            "outline",
            "export-video",
            "version",
        }
        method = "ExecuteTool" if tool in native_tools else "OpenTool"
        script = (
            "$a=[Runtime.InteropServices.Marshal]::GetActiveObject('Kwpp.Application');"
            "$x=$a.COMAddIns.Item('SANDUN.OpenPresentationBootstrap');"
            "$x.Connect=$true; $x.Object." + method + "('" + tool + "')"
        )
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=12,
            startupinfo=startupinfo,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            raise HTTPException(status_code=503, detail=(result.stderr or "WPS 未运行").strip())
        return {"ok": True, "tool": tool}

    index_file = settings.static_dir / "index.html"
    if index_file.is_file():
        # WPS loads the JS add-in entry point from /wps/. Mount the packaged
        # directory explicitly so /wps/ resolves to its own index.html
        # instead of falling through to the task-pane SPA at /.
        wps_dir = settings.static_dir / "wps"
        if wps_dir.is_dir():
            app.mount("/wps", StaticFiles(directory=wps_dir, html=True), name="wps-static")

        assets_dir = settings.static_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(index_file)

        @app.get("/{path:path}")
        def spa_fallback(path: str) -> FileResponse:
            if path.startswith(("local/", "api/")):
                raise HTTPException(status_code=404, detail="接口不存在")
            candidate = (settings.static_dir / path).resolve()
            if settings.static_dir.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index_file)

    return app
