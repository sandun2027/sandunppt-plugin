from pathlib import Path

from cryptography import x509

from ppagent_local.certificates import ensure_local_certificate


def test_generate_local_certificate(tmp_path: Path) -> None:
    cert_path, key_path, thumbprint = ensure_local_certificate(tmp_path)
    certificate = x509.load_pem_x509_certificate(cert_path.read_bytes())
    names = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert "localhost" in names.get_values_for_type(x509.DNSName)
    assert key_path.is_file()
    assert len(thumbprint) == 40
