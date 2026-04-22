from __future__ import annotations

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
