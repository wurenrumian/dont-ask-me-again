from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Awaitable, Callable

from server.config import ServerSettings

class NanobotAdapter:
    def __init__(self, project_root: Path, settings: ServerSettings) -> None:
        self.project_root = project_root
        self.settings = settings
        self._ensure_vendor_on_path()

    async def run_turn(
        self,
        prompt: str,
        session_id: str,
        config_path: Path | None = None,
    ) -> str:
        resolved_config_path = config_path or self._resolve_config_path_or_raise()
        from nanobot import Nanobot

        workspace = self.settings.resolve_workspace(self.project_root)
        workspace.mkdir(parents=True, exist_ok=True)

        bot = Nanobot.from_config(
            config_path=str(resolved_config_path),
            workspace=workspace,
        )
        result = await bot.run(
            prompt,
            session_key=f"{self.settings.nanobot_session_prefix}:{session_id}",
        )
        return result.content

    async def run_turn_stream(
        self,
        prompt: str,
        session_id: str,
        on_delta: Callable[[str], Awaitable[None]],
        config_path: Path | None = None,
    ) -> str:
        resolved_config_path = config_path or self._resolve_config_path_or_raise()
        from nanobot import Nanobot
        from nanobot.agent.hook import AgentHook, AgentHookContext

        workspace = self.settings.resolve_workspace(self.project_root)
        workspace.mkdir(parents=True, exist_ok=True)

        class _StreamingHook(AgentHook):
            def wants_streaming(self) -> bool:
                return True

            async def on_stream(self, context: AgentHookContext, delta: str) -> None:
                if delta:
                    await on_delta(delta)

        bot = Nanobot.from_config(
            config_path=str(resolved_config_path),
            workspace=workspace,
        )
        result = await bot.run(
            prompt,
            session_key=f"{self.settings.nanobot_session_prefix}:{session_id}",
            hooks=[_StreamingHook()],
        )
        return result.content

    def run_turn_sync(self, prompt: str, session_id: str) -> str:
        return asyncio.run(self.run_turn(prompt, session_id))

    def _ensure_vendor_on_path(self) -> None:
        vendor_root = self.project_root / "vendor" / "nanobot"
        vendor_path = str(vendor_root.resolve())

        if vendor_path not in sys.path:
            sys.path.insert(0, vendor_path)

    def _resolve_config_path_or_raise(self) -> Path:
        config_path = self.settings.resolve_config_path(self.project_root)

        if config_path is None:
            raise FileNotFoundError(
                "nanobot config not found. Copy "
                "'server/nanobot.config.example.json' to "
                "'server/nanobot.config.json', then set provider credentials. "
                "Or set DAMA_NANOBOT_CONFIG_PATH."
            )

        if not config_path.exists():
            raise FileNotFoundError(
                f"nanobot config not found at '{config_path}'. "
                "Set DAMA_NANOBOT_CONFIG_PATH to a valid file."
            )

        return config_path
