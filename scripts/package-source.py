"""Produce a source release from an explicit file allowlist, never from Git history."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

from ppagent_local import __version__

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "release"
RELEASE.mkdir(exist_ok=True)
files = set()
files.add(ROOT / "scripts/test-image-options-ui.cjs")
for name in ["README.md", "LICENSE", "NOTICE", ".gitignore", ".env.example", "pyproject.toml", "tool-catalog.json"]:
    files.add(ROOT / name)
for folder, patterns in {
    "docs": ["ARCHITECTURE.md", "VALIDATION.md"],
    "src/ppagent_local": ["*.py", "prompts/*.txt", "prompts/*.json"],
    "tests": ["test_*.py"],
    "packaging": ["bridge_entry.py", "ppagent-local.spec"],
    "installer": ["windows/*.iss", "shell/*.cs", "shell/*.xaml", "shell/*.manifest", "shell/*.py"],
    "native": ["*.cs", "lib/Extensibility.dll", "lib/webview2/*.dll", "lib/webview2/*.txt", "lib/webview2/runtimes/*/native/*.dll", "tests/OpenSourceSmoke.cs"],
    "manifests/wps": ["config.json", "ribbon.js", "ribbon.xml", "index.html"],
    "licenses": ["*"],
    "taskpane": ["package.json", "package-lock.json", "tsconfig*.json", "vite.config.ts", "vitest.config.ts", "index.html", "src/*.ts", "src/*.tsx", "src/*.css", "src/vendor/*.ts", "src/vendor/README.md", "scripts/generate-tools.mjs", "public/icon.svg", "public/brand/*.svg"],
    "scripts": ["build-*.ps1", "build-icons.py", "dev-env.ps1", "setup-dev.ps1", "install-native-bootstrap.ps1", "install-wps-plugin.ps1", "prepare-plugin-update.ps1", "test-plugin-update.ps1", "test-open-native.ps1", "test-open-ui.cjs", "test-ui-server.py", "package-source.py", "cleanup-development.ps1"],
}.items():
    for pattern in patterns:
        files.update(p for p in (ROOT / folder).glob(pattern) if p.is_file())
# Only icon files referenced by the current generated WPS map may be included.
script = (ROOT / "manifests/wps/ribbon.js").read_text(encoding="utf-8")
for icon in re.findall(r'"(icons/[^"\n]+\.svg)"', script):
    files.add(ROOT / "manifests/wps" / icon)
catalogue = json.loads((ROOT / "tool-catalog.json").read_text(encoding="utf-8"))
for name in [x["id"] for x in catalogue] + ["settings", "image", "chart", "diagram"]:
    for prefix in ["", "ribbon-"]:
        files.add(ROOT / "taskpane/public/tools" / (prefix + name + ".svg"))
for name in ["settings", "image", "chart", "diagram"]:
    files.add(ROOT / "taskpane/public" / f"icon-{name}.svg")

suspect = re.compile(rb"(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|agentadmin\.sandun\.cc|https?://sandun\.cc)")
rows = []
for file in sorted(files):
    if not file.is_file() or ROOT not in file.resolve().parents:
        raise RuntimeError(f"Invalid release entry: {file.name}")
    raw = file.read_bytes()
    if file.suffix.lower() not in {".dll"} and suspect.search(raw):
        raise RuntimeError(f"Sensitive/retired content in {file.relative_to(ROOT)}")
    if file.suffix.lower() in {".pem", ".key", ".snk", ".pfx", ".pyc"}:
        raise RuntimeError("Private/runtime file in release")
    rows.append({"path": file.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
archive = RELEASE / f"SANDUN-PPT-OpenSource-{__version__}-source.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for item in rows:
        output.write(ROOT / item["path"], "SANDUN-PPT-OpenSource/" + item["path"])
(RELEASE / "SOURCE-MANIFEST.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
sums = []
for file in sorted(RELEASE.iterdir()):
    if file.suffix in {".exe", ".zip"}:
        sums.append(hashlib.sha256(file.read_bytes()).hexdigest() + "  " + file.name)
(RELEASE / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")
print(f"Source release: {len(rows)} files; {archive.stat().st_size} bytes; secret/retired-endpoint scan passed")
