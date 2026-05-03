from __future__ import annotations

import sys
from pathlib import Path


def detect_resource_root(anchor_file: str | Path | None = None) -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(str(meipass)).resolve()
        return Path(sys.executable).resolve().parent

    if anchor_file is None:
        anchor_file = __file__
    resolved = Path(anchor_file).resolve()
    current = resolved.parent if resolved.is_file() else resolved

    for candidate in (current, *current.parents):
        if candidate.name == "server":
            return candidate.parent.resolve()
        if (candidate / "server").exists() and (candidate / "vendor").exists():
            return candidate.resolve()

    return resolved.parent.parent.resolve()


def detect_state_root(anchor_file: str | Path | None = None) -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return detect_resource_root(anchor_file)


def server_runtime_dir(project_root: Path) -> Path:
    server_dir = project_root / "server"
    if server_dir.exists():
        return server_dir.resolve()
    return project_root.resolve()


def runtime_state_dir(project_root: Path) -> Path:
    return (project_root / ".runtime").resolve()


def runtime_config_path(project_root: Path) -> Path:
    return (server_runtime_dir(project_root) / "nanobot.config.json").resolve()


def runtime_example_path(project_root: Path, resource_root: Path | None = None) -> Path:
    primary = server_runtime_dir(project_root) / "nanobot.config.example.json"
    if primary.exists():
        return primary.resolve()

    resolved_resource_root = resource_root.resolve() if resource_root else project_root.resolve()
    fallback = server_runtime_dir(resolved_resource_root) / "nanobot.config.example.json"
    return fallback.resolve()


def provider_store_path(project_root: Path, filename: str) -> Path:
    return (server_runtime_dir(project_root) / filename).resolve()


def vendor_nanobot_root(project_root: Path, resource_root: Path | None = None) -> Path:
    primary = (project_root / "vendor" / "nanobot").resolve()
    if primary.exists():
        return primary

    resolved_resource_root = resource_root.resolve() if resource_root else project_root.resolve()
    return (resolved_resource_root / "vendor" / "nanobot").resolve()
