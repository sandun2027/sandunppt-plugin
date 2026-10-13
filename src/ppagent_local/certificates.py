from __future__ import annotations

import hashlib
import ipaddress
import json
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def ensure_local_certificate(data_dir: Path, *, trust: bool = False) -> tuple[Path, Path, str]:
    cert_dir = data_dir / "certificates"
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / "localhost-cert.pem"
    key_path = cert_dir / "localhost-key.pem"
    metadata_path = cert_dir / "certificate.json"

    if not cert_path.is_file() or not key_path.is_file():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SANDUN Open Source PPT")])
        now = datetime.now(UTC)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=825))
            .add_extension(
                x509.SubjectAlternativeName(
                    [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
                ),
                critical=False,
            )
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=True,
                    crl_sign=True,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .sign(key, hashes.SHA256())
        )
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )

    certificate = x509.load_pem_x509_certificate(cert_path.read_bytes())
    thumbprint = certificate.fingerprint(hashes.SHA1()).hex().upper()
    metadata_path.write_text(
        json.dumps({"thumbprint": thumbprint, "sha256": hashlib.sha256(cert_path.read_bytes()).hexdigest()}),
        encoding="utf-8",
    )
    if trust:
        # The installer runs elevated so the loopback-only certificate can be trusted machine-wide.
        result = subprocess.run(
            ["certutil.exe", "-addstore", "-f", "Root", str(cert_path)],
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"无法安装本机 HTTPS 证书，certutil 退出码: {result.returncode}")
        if not is_local_certificate_trusted(data_dir):
            raise RuntimeError("本机 HTTPS 证书未被信任，请在 Windows 安全警告中选择“是”")
    return cert_path, key_path, thumbprint


def is_local_certificate_trusted(data_dir: Path) -> bool:
    metadata = data_dir / "certificates" / "certificate.json"
    if not metadata.is_file():
        return False
    thumbprint = str(json.loads(metadata.read_text(encoding="utf-8")).get("thumbprint") or "")
    if len(thumbprint) != 40 or any(char not in "0123456789ABCDEF" for char in thumbprint):
        return False
    verification = subprocess.run(
        ["certutil.exe", "-store", "Root", thumbprint],
        check=False,
        capture_output=True,
        text=True,
    )
    return verification.returncode == 0


def remove_local_certificate(data_dir: Path) -> bool:
    metadata = data_dir / "certificates" / "certificate.json"
    if not metadata.is_file():
        return False
    thumbprint = str(json.loads(metadata.read_text(encoding="utf-8")).get("thumbprint") or "")
    if len(thumbprint) != 40 or any(char not in "0123456789ABCDEF" for char in thumbprint):
        raise RuntimeError("证书指纹无效，拒绝删除")
    subprocess.run(
        ["certutil.exe", "-delstore", "Root", thumbprint],
        check=False,
        capture_output=True,
        text=True,
    )
    for store_name in ("Root", "TrustedPeople", "My"):
        subprocess.run(
            ["certutil.exe", "-user", "-delstore", store_name, thumbprint],
            check=False,
            capture_output=True,
            text=True,
        )
    return True
