from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

from server.context import ServerContext
from server.provider_config_store import build_runtime_config_for_model, get_model_provider_by_id
from server.session_store import SessionRecord


def normalize_session_title(value: str) -> str | None:
    normalized = " ".join(value.strip().strip("\"'").split())
    if not normalized:
        return None
    trimmed = normalized[:80].rstrip(" .,:;!?-")
    return trimmed or None


def build_session_title_prompt(first_user_text: str) -> str:
    return (
        "请根据用户的第一条请求，生成一个10个字左右的中文标题。\n"
        "只返回标题文本。\n"
        "不要返回引号、序号、解释、标签、Markdown 或句号。\n"
        "标题要具体，适合作为会话名称。\n\n"
        f"用户请求：\n{first_user_text.strip()}"
    )


def resolve_title_generation_model(ctx: ServerContext, model_id: str | None):
    if not model_id:
        return None
    return get_model_provider_by_id(ctx.project_root, model_id)


async def run_title_generation_turn(
    ctx: ServerContext,
    *,
    first_user_text: str,
    session_id: str,
    model_entry: Any,
) -> str:
    config_data = build_runtime_config_for_model(ctx.project_root, model_entry)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".json",
        delete=False,
    ) as handle:
        temp_config_path = Path(handle.name)
        json.dump(config_data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    try:
        return await ctx.runtime.run_turn(
            build_session_title_prompt(first_user_text),
            session_id=f"{session_id}:title",
            config_path=temp_config_path,
        )
    finally:
        temp_config_path.unlink(missing_ok=True)


async def generate_session_title(
    ctx: ServerContext,
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    if not first_user_text.strip():
        ctx.session_store.mark_title_generation_done(session.session_id)
        return

    model_entry = resolve_title_generation_model(ctx, title_model_id)
    if model_entry is None:
        ctx.session_store.mark_title_generation_done(session.session_id)
        return

    try:
        raw_title = await run_title_generation_turn(
            ctx,
            first_user_text=first_user_text,
            session_id=session.session_id,
            model_entry=model_entry,
        )
        title = normalize_session_title(raw_title)
        ctx.session_store.set_title(session.session_id, title)
        ctx.session_metadata_store.set_title(session.session_id, title)
    except Exception:
        ctx.logger.exception("[title] generation failed for session %s", session.session_id)
    finally:
        ctx.session_store.mark_title_generation_done(session.session_id)
        if not ctx.session_metadata_store.get(session.session_id).title:
            ctx.session_metadata_store.mark_title_generation_done(session.session_id)


def schedule_session_title_generation(
    ctx: ServerContext,
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    if not ctx.session_store.try_mark_title_generation_running(session.session_id):
        return
    ctx.session_metadata_store.mark_title_generation_running(session.session_id)
    asyncio.create_task(generate_session_title(ctx, session, first_user_text, title_model_id))
