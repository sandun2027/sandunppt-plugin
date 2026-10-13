from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

import uvicorn

from .app import create_app
from .certificates import ensure_local_certificate, is_local_certificate_trusted, remove_local_certificate
from .config import Settings
from .host_lifecycle import start_host_monitor


def run() -> None:
    parser = argparse.ArgumentParser(prog="sandun-open-local")
    parser.add_argument("--generate-certificate", action="store_true")
    parser.add_argument("--install-certificate", action="store_true")
    parser.add_argument("--verify-certificate", action="store_true")
    parser.add_argument("--remove-certificate", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--keep-alive", action="store_true")
    args = parser.parse_args()
    settings = Settings.from_env()
    if args.generate_certificate:
        cert_path, key_path, thumbprint = ensure_local_certificate(settings.data_dir)
        print(f"certificate={cert_path}")
        print(f"key={key_path}")
        print(f"thumbprint={thumbprint}")
        return
    if args.install_certificate:
        cert_path, key_path, thumbprint = ensure_local_certificate(settings.data_dir, trust=True)
        print(f"certificate={cert_path}")
        print(f"key={key_path}")
        print(f"thumbprint={thumbprint}")
        return
    if args.verify_certificate:
        if not is_local_certificate_trusted(settings.data_dir):
            raise RuntimeError("本机 HTTPS 证书未被信任，请在 Windows 安全警告中选择“是”")
        return
    if args.remove_certificate:
        remove_local_certificate(settings.data_dir)
        return
    if args.self_test:
        run_self_test(settings.data_dir)
        return

    cert_path = settings.tls_cert_file
    key_path = settings.tls_key_file
    if not cert_path and not key_path:
        default_cert = settings.data_dir / "certificates" / "localhost-cert.pem"
        default_key = settings.data_dir / "certificates" / "localhost-key.pem"
        if default_cert.is_file() and default_key.is_file():
            cert_path, key_path = default_cert, default_key
    if bool(cert_path) != bool(key_path):
        raise RuntimeError("TLS 证书和私钥必须同时配置")
    settings = replace(settings, tls_cert_file=cert_path, tls_key_file=key_path)
    uvicorn_options: dict[str, object] = {}
    if sys.stdout is None or sys.stderr is None:
        # PyInstaller's windowed executable has no console streams. Uvicorn's
        # default logging setup cannot initialize against those missing handles.
        uvicorn_options.update(log_config=None, access_log=False)
    config = uvicorn.Config(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="info",
        ssl_certfile=str(cert_path) if cert_path else None,
        ssl_keyfile=str(key_path) if key_path else None,
        **uvicorn_options,
    )
    server = uvicorn.Server(config)
    if sys.platform == "win32" and not args.keep_alive:
        start_host_monitor(lambda: setattr(server, "should_exit", True))
    server.run()


def run_self_test(data_dir: Path) -> None:
    from .open_ai import OpenAIService, sanitize_svg, prompt
    from .provider_config import ProviderConfig
    svg, width, height = sanitize_svg('<svg><text x="10" y="30">SANDUN</text></svg>')
    ai = OpenAIService(ProviderConfig(data_dir))
    try:
        assert svg and width == 960 and height == 540
        assert len(ai.gallery) == 122
        for name in ["chart", "cover-plan", "cover-draft", "diagram", "logic-render", "logic-selection"]:
            assert prompt(name)
    finally:
        ai.close()


if __name__ == "__main__":
    run()
