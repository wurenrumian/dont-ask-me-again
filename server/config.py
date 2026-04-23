from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ServerSettings(BaseSettings):
    nanobot_config_path: str | None = Field(default=None)
    nanobot_workspace: str | None = Field(default=None)
    nanobot_session_prefix: str = Field(default="dont-ask-me-again")

    model_config = SettingsConfigDict(
        env_prefix="DAMA_",
        env_file=".env",
        extra="ignore",
    )

    def resolve_workspace(self, project_root: Path) -> Path:
        if self.nanobot_workspace:
            return Path(self.nanobot_workspace).expanduser().resolve()

        return (project_root / ".runtime" / "nanobot-workspace").resolve()

    def resolve_config_path(self, project_root: Path) -> Path | None:
        if self.nanobot_config_path:
            return Path(self.nanobot_config_path).expanduser().resolve()

        default_config_path = (project_root / "server" / "nanobot.config.json").resolve()
        if default_config_path.exists():
            return default_config_path

        return None


def load_runtime_env(project_root: Path) -> None:
    dotenv_candidates = [
        project_root / ".env",
        project_root / "server" / ".env",
    ]
    for dotenv_path in dotenv_candidates:
        _load_dotenv_file(dotenv_path)


def _load_dotenv_file(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        env_key = key.strip()
        if not env_key:
            continue

        env_value = value.strip()
        if (
            (env_value.startswith('"') and env_value.endswith('"'))
            or (env_value.startswith("'") and env_value.endswith("'"))
        ) and len(env_value) >= 2:
            env_value = env_value[1:-1]

        os.environ.setdefault(env_key, env_value)
