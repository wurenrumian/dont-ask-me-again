from __future__ import annotations

import json
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from server.schemas import (
    ModelProviderDeleteRequest,
    ModelProviderDeleteResponse,
    ModelProviderEntry,
    ModelProviderListResponse,
    ModelProviderSaveRequest,
    ModelProviderSaveResponse,
)
from server.provider_secret_store import delete_provider_api_key, get_provider_api_key, has_provider_api_key, set_provider_api_key
from server.runtime_layout import runtime_config_path, runtime_example_path, provider_store_path

MODEL_PROVIDER_STORE_FILENAME = "model_providers.json"
_OFFICIAL_OPENAI_BASES = {"", "https://api.openai.com/v1"}


def _runtime_config_path(project_root: Path) -> Path:
    return runtime_config_path(project_root)


def _runtime_example_path(project_root: Path, resource_root: Path | None = None) -> Path:
    return runtime_example_path(project_root, resource_root)


def _provider_store_path(project_root: Path) -> Path:
    return provider_store_path(project_root, MODEL_PROVIDER_STORE_FILENAME)


def _normalize_api_base(value: str | None) -> str | None:
    normalized = (value or "").strip().rstrip("/")
    return normalized or None


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_base_config(config_path: Path, example_path: Path | None) -> dict[str, Any]:
    if config_path.exists():
        return json.loads(config_path.read_text(encoding="utf-8"))
    if example_path is not None and example_path.exists():
        return json.loads(example_path.read_text(encoding="utf-8"))
    return {}


def _infer_provider_kind(provider: str, api_base: str | None) -> str:
    normalized_base = _normalize_api_base(api_base) or ""
    if provider == "openai" and normalized_base not in _OFFICIAL_OPENAI_BASES:
        return "openai_compatible"
    if provider in {"custom", "openrouter", "azure_openai", "minimax", "deepseek", "ollama"}:
        return "openai_compatible"
    return provider


def _default_capabilities(model: str) -> list[str]:
    lowered = model.lower()
    if "image" in lowered or "imagen" in lowered:
        return ["image"]
    return ["chat", "title"]


def _new_provider(
    *,
    provider_id: str | None = None,
    name: str | None,
    kind: str,
    api_base: str | None,
) -> dict[str, Any]:
    pid = provider_id or str(uuid.uuid4())[:8]
    return {
        "id": pid,
        "name": name or kind.replace("_", " ").title(),
        "kind": kind,
        "api_base": _normalize_api_base(api_base),
    }


def _new_model(
    *,
    model_id: str | None = None,
    provider_id: str,
    model: str,
    label: str | None,
    is_default: bool,
    capabilities: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": model_id or str(uuid.uuid4())[:8],
        "provider_id": provider_id,
        "model": model,
        "label": label,
        "is_default": is_default,
        "capabilities": capabilities or _default_capabilities(model),
    }


def _flatten_model(project_root: Path, provider: dict[str, Any], model: dict[str, Any]) -> dict[str, Any]:
    kind = str(provider.get("kind") or "openai_compatible")
    return {
        "id": str(model["id"]),
        "provider": kind,
        "provider_kind": kind,
        "provider_id": str(provider["id"]),
        "provider_name": str(provider.get("name") or kind),
        "model": str(model["model"]),
        "api_base": _normalize_api_base(provider.get("api_base")),
        "has_api_key": has_provider_api_key(project_root, str(provider["id"])),
        "is_default": bool(model.get("is_default")),
        "label": model.get("label"),
        "capabilities": list(model.get("capabilities") or _default_capabilities(str(model["model"]))),
    }


def _ensure_single_default(models: list[dict[str, Any]]) -> str | None:
    if not models:
        return None
    first_default_id = next((str(item["id"]) for item in models if item.get("is_default")), None)
    if first_default_id is None:
        models[0]["is_default"] = True
        first_default_id = str(models[0]["id"])
    for item in models:
        item["is_default"] = str(item.get("id")) == first_default_id
    return first_default_id


def _read_provider_store(store_path: Path) -> dict[str, list[dict[str, Any]]]:
    if not store_path.exists():
        return {"providers": [], "models": []}

    raw = json.loads(store_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("providers"), list) and isinstance(raw.get("models"), list):
        return {
            "providers": [item for item in raw["providers"] if isinstance(item, dict)],
            "models": [item for item in raw["models"] if isinstance(item, dict)],
        }
    return {"providers": [], "models": []}


def _load_store(project_root: Path) -> dict[str, list[dict[str, Any]]]:
    store_path = _provider_store_path(project_root)
    store = _read_provider_store(store_path)

    _ensure_single_default(store["models"])
    if store["models"] or store["providers"]:
        _write_json(store_path, store)
    return store


def _provider_by_id(store: dict[str, list[dict[str, Any]]], provider_id: str) -> dict[str, Any] | None:
    return next((item for item in store["providers"] if str(item.get("id")) == provider_id), None)


def _model_by_id(store: dict[str, list[dict[str, Any]]], model_id: str) -> dict[str, Any] | None:
    return next((item for item in store["models"] if str(item.get("id")) == model_id), None)


def _build_provider_block(kind: str, model: str, api_base: str | None, api_key: str | None) -> dict[str, Any]:
    block: dict[str, Any] = {}
    normalized_api_base = _normalize_api_base(api_base)
    if kind == "ollama":
        block["apiKey"] = None
        block["apiBase"] = normalized_api_base or "http://127.0.0.1:11434/v1"
    else:
        if api_key:
            block["apiKey"] = api_key
        if normalized_api_base:
            block["apiBase"] = normalized_api_base
        if kind == "azure_openai":
            block["defaultModel"] = model
    return block


def _runtime_provider_name(kind: str, provider_id: str) -> str:
    if kind == "openai_compatible":
        return "openai"
    return kind


def _sync_runtime_config_from_default_model(
    project_root: Path,
    config_data: dict[str, Any],
    store: dict[str, list[dict[str, Any]]],
) -> None:
    config_data.setdefault("providers", {})
    config_data.setdefault("agents", {})
    config_data["agents"].setdefault("defaults", {})  # type: ignore[union-attr]

    default_model = next((item for item in store["models"] if item.get("is_default")), None)
    if default_model is None:
        config_data["providers"] = {}
        config_data["agents"]["defaults"].pop("provider", None)  # type: ignore[index]
        config_data["agents"]["defaults"].pop("model", None)  # type: ignore[index]
        return

    provider = _provider_by_id(store, str(default_model["provider_id"]))
    if provider is None:
        return
    kind = str(provider.get("kind") or "openai_compatible")
    runtime_provider = _runtime_provider_name(kind, str(provider["id"]))
    model = str(default_model["model"])
    config_data["providers"] = {
        runtime_provider: _build_provider_block(
            kind,
            model,
            provider.get("api_base"),
            get_provider_api_key(project_root, str(provider["id"])),
        )
    }
    config_data["agents"]["defaults"]["provider"] = runtime_provider  # type: ignore[index]
    config_data["agents"]["defaults"]["model"] = model  # type: ignore[index]


def ensure_runtime_config_synced(project_root: Path, resource_root: Path | None = None) -> None:
    config_path = _runtime_config_path(project_root)
    example_path = _runtime_example_path(project_root, resource_root)
    config_data = _load_base_config(config_path, example_path)
    store = _load_store(project_root)
    _sync_runtime_config_from_default_model(project_root, config_data, store)
    _write_json(config_path, config_data)


def get_model_provider_by_id(project_root: Path, model_id: str) -> ModelProviderEntry | None:
    store = _load_store(project_root)
    model = _model_by_id(store, model_id)
    if model is None:
        return None
    provider = _provider_by_id(store, str(model["provider_id"]))
    if provider is None:
        return None
    return ModelProviderEntry(**_flatten_model(project_root, provider, model))


def build_runtime_config_for_model(project_root: Path, entry: ModelProviderEntry) -> dict[str, Any]:
    config_path = _runtime_config_path(project_root)
    example_path = _runtime_example_path(project_root)
    config_data = deepcopy(_load_base_config(config_path, example_path))
    config_data.setdefault("providers", {})
    config_data.setdefault("agents", {})
    config_data["agents"].setdefault("defaults", {})  # type: ignore[union-attr]
    kind = entry.provider_kind or entry.provider
    provider_id = entry.provider_id or kind
    runtime_provider = _runtime_provider_name(kind, provider_id)
    config_data["providers"] = {
        runtime_provider: _build_provider_block(
            kind,
            entry.model,
            entry.api_base,
            get_provider_api_key(project_root, entry.provider_id),
        ),
    }
    config_data["agents"]["defaults"]["provider"] = runtime_provider  # type: ignore[index]
    config_data["agents"]["defaults"]["model"] = entry.model  # type: ignore[index]
    return config_data


def list_model_providers(project_root: Path) -> ModelProviderListResponse:
    store = _load_store(project_root)
    entries: list[ModelProviderEntry] = []
    for model in store["models"]:
        provider = _provider_by_id(store, str(model.get("provider_id")))
        if provider is not None:
            entries.append(ModelProviderEntry(**_flatten_model(project_root, provider, model)))
    default_id = next((entry.id for entry in entries if entry.is_default), None)
    return ModelProviderListResponse(entries=entries, default_id=default_id)


def save_model_provider(project_root: Path, payload: ModelProviderSaveRequest) -> ModelProviderSaveResponse:
    config_path = _runtime_config_path(project_root)
    example_path = _runtime_example_path(project_root)
    store_path = _provider_store_path(project_root)
    config_data = _load_base_config(config_path, example_path)
    store = _load_store(project_root)

    existing_model = _model_by_id(store, payload.id) if payload.id else None
    provider_id = payload.provider_id or (str(existing_model["provider_id"]) if existing_model else None)
    provider = _provider_by_id(store, provider_id) if provider_id else None

    if provider is None:
        provider = _new_provider(
            name=payload.provider_name or payload.provider,
            kind=payload.provider,
            api_base=payload.api_base,
        )
        store["providers"].append(provider)
    else:
        provider["name"] = payload.provider_name or provider.get("name") or payload.provider
        provider["kind"] = payload.provider
        provider["api_base"] = _normalize_api_base(payload.api_base)

    api_key_stored = False
    if payload.api_key:
        set_provider_api_key(project_root, str(provider["id"]), payload.api_key)
        api_key_stored = True

    if existing_model is None:
        model = _new_model(
            provider_id=str(provider["id"]),
            model=payload.model,
            label=payload.label,
            is_default=payload.is_default,
            capabilities=payload.capabilities,
        )
        store["models"].append(model)
    else:
        existing_model["provider_id"] = str(provider["id"])
        existing_model["model"] = payload.model
        existing_model["label"] = payload.label
        if payload.capabilities is not None:
            existing_model["capabilities"] = payload.capabilities
        elif not existing_model.get("capabilities"):
            existing_model["capabilities"] = _default_capabilities(payload.model)
        existing_model["is_default"] = payload.is_default
        model = existing_model

    if payload.is_default:
        for item in store["models"]:
            item["is_default"] = str(item.get("id")) == str(model["id"])
    _ensure_single_default(store["models"])

    _write_json(store_path, store)
    _sync_runtime_config_from_default_model(project_root, config_data, store)
    _write_json(config_path, config_data)

    entry = ModelProviderEntry(**_flatten_model(project_root, provider, model))
    return ModelProviderSaveResponse(
        entry=entry,
        api_key_stored=api_key_stored,
    )


def delete_model_provider(project_root: Path, payload: ModelProviderDeleteRequest) -> ModelProviderDeleteResponse:
    config_path = _runtime_config_path(project_root)
    store_path = _provider_store_path(project_root)
    config_data = _load_base_config(config_path, None)
    store = _load_store(project_root)
    model = _model_by_id(store, payload.id)
    if model is None:
        return ModelProviderDeleteResponse(ok=True)

    provider_id = str(model.get("provider_id"))
    store["models"] = [item for item in store["models"] if str(item.get("id")) != payload.id]
    if not any(str(item.get("provider_id")) == provider_id for item in store["models"]):
        store["providers"] = [item for item in store["providers"] if str(item.get("id")) != provider_id]
        delete_provider_api_key(project_root, provider_id)

    _ensure_single_default(store["models"])
    _write_json(store_path, store)
    _sync_runtime_config_from_default_model(project_root, config_data, store)
    _write_json(config_path, config_data)
    return ModelProviderDeleteResponse(ok=True)
