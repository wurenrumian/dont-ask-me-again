import os
from pathlib import Path
from uuid import uuid4

from server.config import ServerSettings, load_runtime_env


def _make_workspace_dir() -> Path:
    workspace = Path(".tmp-test-data") / f"config-{uuid4().hex}"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve()


def test_resolve_config_path_prefers_explicit_setting() -> None:
    tmp_path = _make_workspace_dir()
    explicit = tmp_path / "my-config.json"
    explicit.write_text("{}", encoding="utf-8")

    settings = ServerSettings(
        _env_file=None,
        nanobot_config_path=str(explicit),
    )

    resolved = settings.resolve_config_path(tmp_path)
    assert resolved == explicit.resolve()


def test_resolve_config_path_uses_project_default() -> None:
    tmp_path = _make_workspace_dir()
    default_config = tmp_path / "server" / "nanobot.config.json"
    default_config.parent.mkdir(parents=True, exist_ok=True)
    default_config.write_text("{}", encoding="utf-8")

    settings = ServerSettings(_env_file=None)

    resolved = settings.resolve_config_path(tmp_path)
    assert resolved == default_config.resolve()


def test_load_runtime_env_reads_root_dotenv() -> None:
    tmp_path = _make_workspace_dir()
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("OPENROUTER_API_KEY=test-key\n", encoding="utf-8")

    original = os.environ.pop("OPENROUTER_API_KEY", None)
    try:
        load_runtime_env(tmp_path)
        assert os.environ.get("OPENROUTER_API_KEY") == "test-key"
    finally:
        if original is None:
            os.environ.pop("OPENROUTER_API_KEY", None)
        else:
            os.environ["OPENROUTER_API_KEY"] = original


def test_load_runtime_env_does_not_override_existing_env() -> None:
    tmp_path = _make_workspace_dir()
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("OPENROUTER_API_KEY=from-dotenv\n", encoding="utf-8")

    original = os.environ.get("OPENROUTER_API_KEY")
    os.environ["OPENROUTER_API_KEY"] = "already-set"
    try:
        load_runtime_env(tmp_path)
        assert os.environ.get("OPENROUTER_API_KEY") == "already-set"
    finally:
        if original is None:
            os.environ.pop("OPENROUTER_API_KEY", None)
        else:
            os.environ["OPENROUTER_API_KEY"] = original
