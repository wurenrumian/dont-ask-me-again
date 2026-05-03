import os
from pathlib import Path
from uuid import uuid4

from server.config import ServerSettings, load_runtime_env
from server.runtime_layout import (
    detect_resource_root,
    detect_state_root,
    runtime_config_path,
    runtime_example_path,
    server_runtime_dir,
)


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


def test_server_runtime_dir_supports_packaged_layout() -> None:
    tmp_path = _make_workspace_dir()

    assert server_runtime_dir(tmp_path) == tmp_path


def test_runtime_example_path_falls_back_to_resource_root() -> None:
    state_root = _make_workspace_dir()
    resource_root = _make_workspace_dir()
    example_path = resource_root / "server" / "nanobot.config.example.json"
    example_path.parent.mkdir(parents=True, exist_ok=True)
    example_path.write_text("{}", encoding="utf-8")

    assert runtime_example_path(state_root, resource_root) == example_path.resolve()


def test_detect_roots_use_executable_and_meipass_when_frozen(monkeypatch) -> None:
    state_root = _make_workspace_dir()
    resource_root = _make_workspace_dir()
    executable_path = state_root / "server.exe"
    executable_path.write_text("", encoding="utf-8")

    monkeypatch.setattr("server.runtime_layout.sys.frozen", True, raising=False)
    monkeypatch.setattr("server.runtime_layout.sys.executable", str(executable_path), raising=False)
    monkeypatch.setattr("server.runtime_layout.sys._MEIPASS", str(resource_root), raising=False)

    assert detect_state_root(__file__) == state_root.resolve()
    assert detect_resource_root(__file__) == resource_root.resolve()


def test_detect_resource_root_from_nested_server_module() -> None:
    nested_file = Path("D:/repo/server/services/image_generation.py")
    assert detect_resource_root(nested_file) == Path("D:/repo").resolve()


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
