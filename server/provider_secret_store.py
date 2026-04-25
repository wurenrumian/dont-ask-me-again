from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PROVIDER_SECRET_STORE_FILENAME = "provider_secrets.json"


def provider_secret_store_path(project_root: Path) -> Path:
    return (project_root / "server" / PROVIDER_SECRET_STORE_FILENAME).resolve()


def _read_store(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"providers": {}}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return {"providers": {}}
    providers = raw.get("providers")
    if not isinstance(providers, dict):
        return {"providers": {}}
    return {"providers": providers}


def _write_store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_provider_api_key(project_root: Path, provider_id: str | None) -> str | None:
    if not provider_id:
        return None
    store = _read_store(provider_secret_store_path(project_root))
    provider = store["providers"].get(provider_id)
    if not isinstance(provider, dict):
        return None
    api_key = provider.get("api_key")
    return api_key if isinstance(api_key, str) and api_key else None


def set_provider_api_key(project_root: Path, provider_id: str, api_key: str) -> None:
    store_path = provider_secret_store_path(project_root)
    store = _read_store(store_path)
    provider = store["providers"].setdefault(provider_id, {})
    if isinstance(provider, dict):
        provider["api_key"] = api_key
    _write_store(store_path, store)


def delete_provider_api_key(project_root: Path, provider_id: str) -> None:
    store_path = provider_secret_store_path(project_root)
    store = _read_store(store_path)
    store["providers"].pop(provider_id, None)
    _write_store(store_path, store)


def has_provider_api_key(project_root: Path, provider_id: str | None) -> bool:
    return get_provider_api_key(project_root, provider_id) is not None
