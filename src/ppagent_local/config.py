from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_data_dir() -> Path:
    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "SANDUNPPTOpenSource"
    return Path.home() / ".ppagent-ppt-plugin"


@dataclass(frozen=True, slots=True)
class Settings:
    host: str
    port: int
    data_dir: Path
    static_dir: Path
    dev_origin: str | None
    tls_cert_file: Path | None = None
    tls_key_file: Path | None = None
    secure_cookies: bool = True
    enforce_loopback: bool = True
    job_ttl_seconds: int = 24 * 60 * 60
    max_workers: int = 1
    conversion_timeout_seconds: int = 15 * 60

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @classmethod
    def from_env(cls) -> Settings:
        package_static = Path(__file__).resolve().parent / "static"
        data_dir_raw = os.getenv("PPAGENT_LOCAL_DATA_DIR", "").strip()
        static_dir_raw = os.getenv("PPAGENT_LOCAL_STATIC_DIR", "").strip()
        dev_origin = os.getenv("PPAGENT_DEV_ORIGIN", "").strip() or None
        tls_cert_raw = os.getenv("PPAGENT_TLS_CERT_FILE", "").strip()
        tls_key_raw = os.getenv("PPAGENT_TLS_KEY_FILE", "").strip()
        return cls(
            host=os.getenv("PPAGENT_LOCAL_HOST", "127.0.0.1"),
            port=int(os.getenv("PPAGENT_LOCAL_PORT", "17667")),
            data_dir=Path(data_dir_raw) if data_dir_raw else _default_data_dir(),
            static_dir=Path(static_dir_raw) if static_dir_raw else package_static,
            dev_origin=dev_origin,
            tls_cert_file=Path(tls_cert_raw) if tls_cert_raw else None,
            tls_key_file=Path(tls_key_raw) if tls_key_raw else None,
            secure_cookies=os.getenv("PPAGENT_SECURE_COOKIES", "1") != "0",
            enforce_loopback=os.getenv("PPAGENT_ENFORCE_LOOPBACK", "1") != "0",
        )

    def prepare(self) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
