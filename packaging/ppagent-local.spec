# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).parent
src = root / "src"
datas = [(str(src / "ppagent_local" / "static"), "ppagent_local/static")]
datas.append((str(src / "ppagent_local" / "prompts"), "ppagent_local/prompts"))
hiddenimports = []
binaries = []

for package in ("cryptography",):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    hiddenimports += package_hidden
    binaries += package_binaries

a = Analysis(
    [str(root / "packaging" / "bridge_entry.py")],
    pathex=[str(src)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["pytest", "skia", "cairosvg", "numpy", "pptx", "keyring", "svgpathtools"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sandun-open-local",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name="sandun-open-local",
)
