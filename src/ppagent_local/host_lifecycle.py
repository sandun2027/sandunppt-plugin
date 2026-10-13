from __future__ import annotations

import ctypes
import os
import threading
from collections.abc import Callable, Iterable
from ctypes import wintypes

OFFICE_HOST_NAMES = frozenset({"powerpnt.exe", "wpp.exe"})
WPS_SHELL_NAME = "wps.exe"


def iter_processes() -> Iterable[tuple[int, str]]:
    if os.name != "nt":
        return ()

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    class ProcessEntry32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    if snapshot == wintypes.HANDLE(-1).value:
        return ()

    entry = ProcessEntry32()
    entry.dwSize = ctypes.sizeof(ProcessEntry32)
    processes: list[tuple[int, str]] = []
    try:
        if kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                processes.append((int(entry.th32ProcessID), entry.szExeFile.lower()))
                if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                    break
    finally:
        kernel32.CloseHandle(snapshot)
    return processes


def visible_window_process_ids() -> set[int]:
    if os.name != "nt":
        return set()

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    process_ids: set[int] = set()
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    @callback_type
    def collect(hwnd: int, _: int) -> bool:
        if user32.IsWindowVisible(hwnd) and user32.GetWindow(hwnd, 4) == 0:
            process_id = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
            if process_id.value:
                process_ids.add(int(process_id.value))
        return True

    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.EnumWindows(collect, 0)
    return process_ids


def presentation_host_running(
    processes: Iterable[tuple[int, str]] | None = None,
    visible_process_ids: set[int] | None = None,
) -> bool:
    processes = tuple(processes if processes is not None else iter_processes())
    if any(name in OFFICE_HOST_NAMES for _, name in processes):
        return True
    visible_process_ids = visible_process_ids if visible_process_ids is not None else visible_window_process_ids()
    return any(process_id in visible_process_ids and name == WPS_SHELL_NAME for process_id, name in processes)


def start_host_monitor(
    request_shutdown: Callable[[], None],
    *,
    idle_seconds: float = 15.0,
    poll_seconds: float = 2.0,
    host_running: Callable[[], bool] = presentation_host_running,
) -> threading.Thread:
    def monitor() -> None:
        idle_elapsed = 0.0
        while True:
            if host_running():
                idle_elapsed = 0.0
            else:
                idle_elapsed += poll_seconds
                if idle_elapsed >= idle_seconds:
                    request_shutdown()
                    return
            threading.Event().wait(poll_seconds)

    thread = threading.Thread(target=monitor, name="presentation-host-monitor", daemon=True)
    thread.start()
    return thread
