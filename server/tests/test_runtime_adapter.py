import asyncio
from pathlib import Path
from uuid import uuid4

import pytest

from server.config import ServerSettings
from server.runtime.nanobot_adapter import NanobotAdapter


def _make_workspace_dir() -> Path:
    workspace = Path(".tmp-test-data") / f"runtime-{uuid4().hex}"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve()


def test_run_turn_raises_when_config_is_missing() -> None:
    tmp_path = _make_workspace_dir()
    settings = ServerSettings(_env_file=None)
    adapter = NanobotAdapter(project_root=tmp_path, settings=settings)

    with pytest.raises(FileNotFoundError, match="nanobot config"):
        asyncio.run(adapter.run_turn("hello", "sess_1"))
