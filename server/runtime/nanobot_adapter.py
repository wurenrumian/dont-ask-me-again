from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from server.config import ServerSettings

class NanobotAdapter:
    def __init__(self, project_root: Path, settings: ServerSettings) -> None:
        self.project_root = project_root
        self.settings = settings
        self._ensure_vendor_on_path()

    async def run_turn(self, prompt: str, session_id: str) -> str:
        from nanobot import Nanobot

        workspace = self.settings.resolve_workspace(self.project_root)
        workspace.mkdir(parents=True, exist_ok=True)

        bot = Nanobot.from_config(
            config_path=self.settings.nanobot_config_path,
            workspace=workspace,
        )
        result = await bot.run(
            prompt,
            session_key=f"{self.settings.nanobot_session_prefix}:{session_id}",
        )
        return result.content

    def run_turn_sync(self, prompt: str, session_id: str) -> str:
        return asyncio.run(self.run_turn(prompt, session_id))

    def _ensure_vendor_on_path(self) -> None:
        vendor_root = self.project_root / "vendor" / "nanobot"
        vendor_path = str(vendor_root.resolve())

        if vendor_path not in sys.path:
            sys.path.insert(0, vendor_path)
