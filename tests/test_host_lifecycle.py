from __future__ import annotations

import threading

from ppagent_local.host_lifecycle import presentation_host_running, start_host_monitor


def test_detects_powerpoint_and_wpp_processes() -> None:
    assert presentation_host_running([(10, "powerpnt.exe")], set())
    assert presentation_host_running([(11, "wpp.exe")], set())


def test_wps_shell_requires_a_visible_window() -> None:
    processes = [(20, "wps.exe")]
    assert presentation_host_running(processes, {20})
    assert not presentation_host_running(processes, set())


def test_ignores_unrelated_background_processes() -> None:
    assert not presentation_host_running([(30, "wpscloudsvr.exe"), (31, "explorer.exe")], {31})


def test_monitor_requests_shutdown_after_idle_grace() -> None:
    shutdown_requested = threading.Event()
    thread = start_host_monitor(
        shutdown_requested.set,
        idle_seconds=0.02,
        poll_seconds=0.01,
        host_running=lambda: False,
    )
    assert shutdown_requested.wait(1)
    thread.join(1)
    assert not thread.is_alive()
