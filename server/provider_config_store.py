from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from server.schemas import (
    ModelProviderDeleteRequest,
    ModelProviderDeleteResponse,
    ModelProviderEntry,
    ModelProviderListResponse,
    ModelProviderSaveRequest,
    ModelProviderSaveResponse,
    ProviderConfigRequest,
    ProviderConfigResult,
)

PROVIDER_KEY_ENV: dict[str, str | None] = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "custom": "CUSTOM_API_KEY",
    "azure_openai": "AZURE_OPENAI_API_KEY",
    "ollama": None,
}

MODEL_PROVIDER_CONFIG_KEY = "model_providers"  # legacy key in runtime config
MODEL_PROVIDER_STORE_FILENAME = "model_providers.json"
_ENV_PLACEHOLDER_RE = re.compile(r"^\$\{([A-Z0-9_]+)\}$")


def _runtime_config_path(project_root: Path) -> Path:
    return (project_root / "server" / "nanobot.config.json").resolve()


def _runtime_example_path(project_root: Path) -> Path:
    return (project_root / "server" / "nanobot.config.example.json").resolve()


def _dotenv_path(project_root: Path) -> Path:
    return (project_root / "server" / ".env").resolve()


def _provider_store_path(project_root: Path) -> Path:
    return (project_root / "server" / MODEL_PROVIDER_STORE_FILENAME).resolve()


def apply_provider_config(project_root: Path, payload: ProviderConfigRequest) -> ProviderConfigResult:
    """兼容旧接口，但底层走统一的 model-provider 存储与同步逻辑。"""
    config_data = _load_base_config(_runtime_config_path(project_root), None)
    entries_data = _load_entries_with_migration(project_root, config_data)
    default_entry_id = next(
        (str(entry.get("id")) for entry in entries_data if entry.get("is_default")),
        None,
    )

    save_model_provider(
        project_root,
        ModelProviderSaveRequest(
            id=default_entry_id,
            provider=payload.provider,
            model=payload.model,
            api_base=_normalize_api_base(payload.api_base),
            api_key=payload.api_key,
            is_default=True,
            label=None,
        ),
    )

    provider_key_env = PROVIDER_KEY_ENV[payload.provider]
    has_api_key = True if provider_key_env is None else bool(os.environ.get(provider_key_env))

    return ProviderConfigResult(
        provider=payload.provider,
        model=payload.model,
        api_base=_normalize_api_base(payload.api_base),
        api_key_env=provider_key_env,
        has_api_key=has_api_key,
    )


def _load_base_config(config_path: Path, example_path: Path | None) -> dict[str, Any]:
    if config_path.exists():
        return json.loads(config_path.read_text(encoding="utf-8"))
    if example_path is not None and example_path.exists():
        return json.loads(example_path.read_text(encoding="utf-8"))
    return {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _upsert_env_value(dotenv_path: Path, key: str, value: str) -> None:
    lines: list[str] = []
    if dotenv_path.exists():
        lines = dotenv_path.read_text(encoding="utf-8").splitlines()

    replaced = False
    out_lines: list[str] = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            out_lines.append(f"{key}={value}")
            replaced = True
        else:
            out_lines.append(line)

    if not replaced:
        out_lines.append(f"{key}={value}")

    dotenv_path.parent.mkdir(parents=True, exist_ok=True)
    dotenv_path.write_text("\n".join(out_lines).rstrip() + "\n", encoding="utf-8")


def _normalize_api_base(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _extract_env_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    match = _ENV_PLACEHOLDER_RE.match(value.strip())
    if not match:
        return None
    return match.group(1)


def _build_provider_block(provider: str, model: str, api_base: str | None) -> dict[str, Any]:
    provider_key_env = PROVIDER_KEY_ENV[provider]
    block: dict[str, Any] = {}
    normalized_api_base = _normalize_api_base(api_base)

    if provider == "ollama":
        block["apiKey"] = None
        block["apiBase"] = normalized_api_base or "http://127.0.0.1:11434/v1"
    else:
        if provider_key_env is not None:
            block["apiKey"] = f"${{{provider_key_env}}}"
        if normalized_api_base:
            block["apiBase"] = normalized_api_base
        if provider == "azure_openai":
            block["defaultModel"] = model

    return block


def _ensure_single_default(entries_data: list[dict[str, Any]]) -> str | None:
    if not entries_data:
        return None

    first_default_id: str | None = None
    for entry_data in entries_data:
        if entry_data.get("is_default"):
            first_default_id = str(entry_data.get("id"))
            break

    if first_default_id is None:
        entries_data[0]["is_default"] = True
        first_default_id = str(entries_data[0]["id"])

    for entry_data in entries_data:
        entry_data["is_default"] = str(entry_data.get("id")) == first_default_id

    return first_default_id


def _bootstrap_entries_from_runtime(config_data: dict[str, Any]) -> list[dict[str, Any]]:
    agents_defaults = config_data.get("agents", {}).get("defaults", {})
    provider = agents_defaults.get("provider")
    model = agents_defaults.get("model")
    if not isinstance(provider, str) or not isinstance(model, str) or not provider or not model:
        return []

    provider_block = config_data.get("providers", {}).get(provider, {})
    api_base = None
    api_key_env = None
    if isinstance(provider_block, dict):
        api_base = _normalize_api_base(provider_block.get("apiBase"))
        api_key_env = _extract_env_name(provider_block.get("apiKey"))
    if api_key_env is None:
        api_key_env = PROVIDER_KEY_ENV.get(provider)

    return [
        {
            "id": f"default-{provider}",
            "provider": provider,
            "model": model,
            "api_base": api_base,
            "api_key_env": api_key_env,
            "is_default": True,
            "label": None,
        }
    ]


def _read_provider_store(store_path: Path) -> list[dict[str, Any]]:
    if not store_path.exists():
        return []

    raw = json.loads(store_path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        entries = raw.get("entries", [])
        if isinstance(entries, list):
            return [item for item in entries if isinstance(item, dict)]

    return []


def _write_provider_store(store_path: Path, entries_data: list[dict[str, Any]]) -> None:
    _write_json(store_path, {"entries": entries_data})


def _load_entries_with_migration(project_root: Path, config_data: dict[str, Any]) -> list[dict[str, Any]]:
    config_path = _runtime_config_path(project_root)
    store_path = _provider_store_path(project_root)

    entries_data = _read_provider_store(store_path)

    if not entries_data:
        legacy_entries = config_data.get(MODEL_PROVIDER_CONFIG_KEY)
        if isinstance(legacy_entries, list) and legacy_entries:
            entries_data = [item for item in legacy_entries if isinstance(item, dict)]
            config_data.pop(MODEL_PROVIDER_CONFIG_KEY, None)
            _write_json(config_path, config_data)

    if not entries_data:
        entries_data = _bootstrap_entries_from_runtime(config_data)

    if not entries_data:
        return []

    _ensure_single_default(entries_data)
    _write_provider_store(store_path, entries_data)
    return entries_data


def _sync_runtime_config_from_default_entry(
    config_data: dict[str, Any],
    entries_data: list[dict[str, Any]],
) -> None:
    config_data.setdefault("providers", {})
    config_data.setdefault("agents", {})
    config_data["agents"].setdefault("defaults", {})  # type: ignore[union-attr]

    default_entry = next((item for item in entries_data if item.get("is_default")), None)
    if default_entry is None:
        config_data["providers"] = {}
        config_data["agents"]["defaults"].pop("provider", None)  # type: ignore[index]
        config_data["agents"]["defaults"].pop("model", None)  # type: ignore[index]
        config_data.pop(MODEL_PROVIDER_CONFIG_KEY, None)
        return

    provider = str(default_entry["provider"])
    model = str(default_entry["model"])
    api_base = _normalize_api_base(default_entry.get("api_base"))

    config_data["providers"] = {
        provider: _build_provider_block(provider, model, api_base),
    }
    config_data["agents"]["defaults"]["provider"] = provider  # type: ignore[index]
    config_data["agents"]["defaults"]["model"] = model  # type: ignore[index]
    config_data.pop(MODEL_PROVIDER_CONFIG_KEY, None)


def ensure_runtime_config_synced(project_root: Path) -> None:
    """Ensure invoke path always reads runtime config derived from model-provider store."""
    config_path = _runtime_config_path(project_root)
    example_path = _runtime_example_path(project_root)
    config_data = _load_base_config(config_path, example_path)
    entries_data = _load_entries_with_migration(project_root, config_data)

    if not entries_data:
        return

    _sync_runtime_config_from_default_entry(config_data, entries_data)
    _write_json(config_path, config_data)


# --- Model-Provider List Operations ---

def list_model_providers(project_root: Path) -> ModelProviderListResponse:
    """获取所有 model-provider 配置"""
    config_data = _load_base_config(_runtime_config_path(project_root), None)
    entries_data = _load_entries_with_migration(project_root, config_data)

    entries = [ModelProviderEntry(**item) for item in entries_data]

    default_id: str | None = None
    for entry in entries:
        if entry.is_default:
            default_id = entry.id
            break

    return ModelProviderListResponse(entries=entries, default_id=default_id)


def save_model_provider(project_root: Path, payload: ModelProviderSaveRequest) -> ModelProviderSaveResponse:
    """保存或更新一个 model-provider 配置"""
    config_path = _runtime_config_path(project_root)
    example_path = _runtime_example_path(project_root)
    store_path = _provider_store_path(project_root)
    dotenv_path = _dotenv_path(project_root)

    config_data = _load_base_config(config_path, example_path)
    entries_data = _load_entries_with_migration(project_root, config_data)

    provider_key_env = PROVIDER_KEY_ENV[payload.provider]
    api_key_stored = False
    api_key_env_name: str | None = None

    if payload.api_key:
        api_key_env_name = provider_key_env
        if provider_key_env is not None:
            _upsert_env_value(dotenv_path, provider_key_env, payload.api_key)
            os.environ[provider_key_env] = payload.api_key
            api_key_stored = True
    elif provider_key_env is not None:
        api_key_env_name = provider_key_env

    target_id: str
    if payload.id:
        target_id = payload.id
        found = False
        for i, entry_data in enumerate(entries_data):
            if entry_data.get("id") == payload.id:
                entries_data[i] = {
                    "id": payload.id,
                    "provider": payload.provider,
                    "model": payload.model,
                    "api_base": _normalize_api_base(payload.api_base),
                    "api_key_env": api_key_env_name,
                    "is_default": payload.is_default,
                    "label": payload.label,
                }
                found = True
                break
        if not found:
            target_id = str(uuid.uuid4())[:8]
            entries_data.append(
                {
                    "id": target_id,
                    "provider": payload.provider,
                    "model": payload.model,
                    "api_base": _normalize_api_base(payload.api_base),
                    "api_key_env": api_key_env_name,
                    "is_default": payload.is_default,
                    "label": payload.label,
                }
            )
    else:
        target_id = str(uuid.uuid4())[:8]
        entries_data.append(
            {
                "id": target_id,
                "provider": payload.provider,
                "model": payload.model,
                "api_base": _normalize_api_base(payload.api_base),
                "api_key_env": api_key_env_name,
                "is_default": payload.is_default,
                "label": payload.label,
            }
        )

    if payload.is_default:
        for entry_data in entries_data:
            if entry_data.get("id") != target_id:
                entry_data["is_default"] = False

    _ensure_single_default(entries_data)
    _write_provider_store(store_path, entries_data)

    _sync_runtime_config_from_default_entry(config_data, entries_data)
    _write_json(config_path, config_data)

    entry = ModelProviderEntry(
        id=target_id,
        provider=payload.provider,
        model=payload.model,
        api_base=_normalize_api_base(payload.api_base),
        api_key_env=api_key_env_name,
        is_default=next(
            (bool(item.get("is_default")) for item in entries_data if item.get("id") == target_id),
            False,
        ),
        label=payload.label,
    )

    return ModelProviderSaveResponse(
        entry=entry,
        api_key_env=api_key_env_name,
        api_key_stored=api_key_stored,
    )


def delete_model_provider(project_root: Path, payload: ModelProviderDeleteRequest) -> ModelProviderDeleteResponse:
    """删除一个 model-provider 配置"""
    config_path = _runtime_config_path(project_root)
    store_path = _provider_store_path(project_root)

    config_data = _load_base_config(config_path, None)
    entries_data = _load_entries_with_migration(project_root, config_data)
    if not entries_data:
        return ModelProviderDeleteResponse(ok=True)

    remaining_entries = [entry for entry in entries_data if entry.get("id") != payload.id]

    if remaining_entries:
        _ensure_single_default(remaining_entries)
        _write_provider_store(store_path, remaining_entries)
    elif store_path.exists():
        store_path.unlink()

    _sync_runtime_config_from_default_entry(config_data, remaining_entries)
    _write_json(config_path, config_data)

    return ModelProviderDeleteResponse(ok=True)
