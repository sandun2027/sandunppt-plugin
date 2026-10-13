from __future__ import annotations

import os
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET


def _run_script(script: Path, appdata: Path, *, uninstall: bool = False) -> None:
    command = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-InstallDir",
        str(script.parent.parent),
    ]
    if uninstall:
        command.append("-Uninstall")
    subprocess.run(
        command,
        check=True,
        capture_output=True,
        env=os.environ | {"APPDATA": str(appdata)},
    )


def test_wps_registration_merges_publish_and_legacy_files(tmp_path: Path) -> None:
    script = Path(__file__).parents[1] / "scripts" / "install-wps-plugin.ps1"
    config_dir = tmp_path / "kingsoft" / "wps" / "jsaddons"
    config_dir.mkdir(parents=True)
    seed = '<?xml version="1.0"?><jsplugins><jspluginonline name="OtherPlugin" type="wpp"/></jsplugins>'
    for filename in ("publish.xml", "jsplugins.xml"):
        (config_dir / filename).write_text(seed, encoding="utf-8")

    _run_script(script, tmp_path)

    for filename in ("publish.xml", "jsplugins.xml"):
        root = ET.parse(config_dir / filename).getroot()
        nodes = {node.get("name"): node for node in root.findall("jspluginonline")}
        assert set(nodes) == {"OtherPlugin", "SANDUNPPTOpenSource"}
        assert nodes["SANDUNPPTOpenSource"].get("url") == "https://127.0.0.1:17667/wps/"
    publish = ET.parse(config_dir / "publish.xml").getroot()
    plugin = next(node for node in publish.findall("jspluginonline") if node.get("name") == "SANDUNPPTOpenSource")
    assert plugin.get("debug") is None
    assert plugin.get("enable") == "enable_dev"
    assert plugin.get("install") is None

    _run_script(script, tmp_path, uninstall=True)

    for filename in ("publish.xml", "jsplugins.xml"):
        names = [node.get("name") for node in ET.parse(config_dir / filename).getroot()]
        assert names == ["OtherPlugin"]


def test_open_source_ribbon_and_isolated_registration():
    root = Path(__file__).parents[1]
    native = (root / "native/SANDUN.PresentationBootstrap.cs").read_text(encoding="utf-8")
    wps = (root / "manifests/wps/ribbon.xml").read_text(encoding="utf-8")
    js = (root / "manifests/wps/ribbon.js").read_text(encoding="utf-8")
    for text in [native, wps, js]:
        assert "生成 PPT" not in text and "我的项目" not in text
        assert "/local/session" not in text and "agentadmin" not in text
    assert 'label=""配置""' in native and 'label="配置"' in wps
    assert 'SANDUN.OpenPresentationBootstrap' in native and 'SANDUN.OpenPresentationBootstrap' in js
    assert 'OpenWindow("settings")' in native and 'SANDUNOpenTool("settings")' in js
    assert '17667' in native
    install = (root / "scripts/install-native-bootstrap.ps1").read_text(encoding="utf-8")
    assert 'SANDUNPPTOpenSource' in install
    assert 'DFB0641B-FA91-4437-9134-BB59480C8C8E' in (root / "installer/windows/PPTagentPPTPlugin.iss").read_text(encoding="utf-8")
