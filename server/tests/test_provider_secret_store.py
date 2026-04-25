from pathlib import Path
from uuid import uuid4

from server.provider_secret_store import (
    delete_provider_api_key,
    get_provider_api_key,
    has_provider_api_key,
    provider_secret_store_path,
    set_provider_api_key,
)


def _workspace() -> Path:
    workspace = Path(".tmp-test-data") / f"provider-secrets-{uuid4().hex}"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve()


def test_provider_secrets_are_stored_by_provider_id() -> None:
    workspace = _workspace()

    set_provider_api_key(workspace, "packy", "sk-packy")

    assert get_provider_api_key(workspace, "packy") == "sk-packy"
    assert has_provider_api_key(workspace, "packy") is True
    assert "sk-packy" in provider_secret_store_path(workspace).read_text(encoding="utf-8")


def test_delete_provider_secret_removes_only_that_provider() -> None:
    workspace = _workspace()
    set_provider_api_key(workspace, "packy", "sk-packy")
    set_provider_api_key(workspace, "openai", "sk-openai")

    delete_provider_api_key(workspace, "packy")

    assert get_provider_api_key(workspace, "packy") is None
    assert get_provider_api_key(workspace, "openai") == "sk-openai"
