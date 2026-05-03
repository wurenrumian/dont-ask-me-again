from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Awaitable, Callable

from server.config import ServerSettings
from server.runtime_layout import runtime_example_path, vendor_nanobot_root
from server.schemas import ImageGenerationOptions
from server.services.image_generation import ImagePayload, ImageGenerationTool, generate_image_with_model
from loguru import logger

class NanobotAdapter:
    def __init__(self, project_root: Path, settings: ServerSettings, resource_root: Path | None = None) -> None:
        self.project_root = project_root
        self.resource_root = resource_root or project_root
        self.settings = settings
        self._ensure_vendor_on_path()

    async def run_turn(
        self,
        prompt: str,
        session_id: str,
        config_path: Path | None = None,
        image_generation: ImageGenerationOptions | None = None,
        on_image: Callable[[ImagePayload], Awaitable[None]] | None = None,
    ) -> str:
        resolved_config_path = config_path or self._resolve_config_path_or_raise()
        from nanobot import Nanobot

        workspace = self.settings.resolve_workspace(self.project_root)
        workspace.mkdir(parents=True, exist_ok=True)

        bot = Nanobot.from_config(
            config_path=str(resolved_config_path),
            workspace=workspace,
        )
        self._configure_image_generation_tool(bot, image_generation, on_image)
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
        image_generation: ImageGenerationOptions | None = None,
        on_image: Callable[[ImagePayload], Awaitable[None]] | None = None,
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
        self._configure_image_generation_tool(bot, image_generation, on_image)
        result = await bot.run(
            prompt,
            session_key=f"{self.settings.nanobot_session_prefix}:{session_id}",
            hooks=[_StreamingHook()],
        )
        return result.content

    def _configure_image_generation_tool(
        self,
        bot,
        image_generation: ImageGenerationOptions | None,
        on_image: Callable[[ImagePayload], Awaitable[None]] | None,
    ) -> None:
        if not image_generation or not image_generation.enabled or not image_generation.model_id:
            logger.debug("[image] generate_image tool not registered for this turn")
            return

        async def generate(prompt: str, filename: str) -> ImagePayload:
            return await generate_image_with_model(
                project_root=self.project_root,
                model_id=image_generation.model_id or "",
                prompt=prompt,
                filename=filename,
                options=image_generation,
            )

        async def emit(payload: ImagePayload) -> None:
            if on_image:
                await on_image(payload)

        bot._loop.tools.register(
            ImageGenerationTool(
                options=image_generation,
                generate_image=generate,
                emit_image=emit,
            )
        )
        logger.info(
            "[image] registered generate_image tool model_id={} max_images={}",
            image_generation.model_id,
            image_generation.max_images,
        )

    def run_turn_sync(self, prompt: str, session_id: str) -> str:
        return asyncio.run(self.run_turn(prompt, session_id))

    def _ensure_vendor_on_path(self) -> None:
        vendor_root = vendor_nanobot_root(self.project_root, self.resource_root)
        vendor_path = str(vendor_root.resolve())

        if vendor_path not in sys.path:
            sys.path.insert(0, vendor_path)

    def _resolve_config_path_or_raise(self) -> Path:
        config_path = self.settings.resolve_config_path(self.project_root)

        if config_path is None:
            example_path = runtime_example_path(self.project_root, self.resource_root)
            raise FileNotFoundError(
                f"nanobot config not found. Copy '{example_path}' to "
                f"'{config_path or example_path.with_name('nanobot.config.json')}', then set provider credentials. "
                "Or set DAMA_NANOBOT_CONFIG_PATH."
            )

        if not config_path.exists():
            raise FileNotFoundError(
                f"nanobot config not found at '{config_path}'. "
                "Set DAMA_NANOBOT_CONFIG_PATH to a valid file."
            )

        return config_path
