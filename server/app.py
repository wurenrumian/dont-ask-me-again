from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.config import ServerSettings, load_runtime_env
from server.context import ServerContext
from server.provider_config_store import (
    apply_provider_config,
    build_runtime_config_for_model,
    ensure_runtime_config_synced,
    get_model_provider_by_id,
)
from server.routes import chat, providers, sessions
from server.runtime.nanobot_adapter import NanobotAdapter
from server.services import title_generator
from server.session_metadata_store import SessionMetadataStore
from server.session_store import InMemorySessionStore, SessionRecord

project_root = Path(__file__).resolve().parent.parent
load_runtime_env(project_root)
settings = ServerSettings()
session_store = InMemorySessionStore()
session_metadata_store = SessionMetadataStore.for_project(project_root)
runtime = NanobotAdapter(project_root=project_root, settings=settings)
ensure_runtime_config_synced(project_root)
logger = logging.getLogger("dama.server")

server_context = ServerContext(
    project_root=project_root,
    settings=settings,
    session_store=session_store,
    session_metadata_store=session_metadata_store,
    runtime=runtime,
    logger=logger,
)

app = FastAPI(title="dont-ask-me-again-server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat.create_router(server_context))
app.include_router(providers.create_router(server_context))
app.include_router(sessions.create_router(server_context))


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


# Compatibility exports for existing tests and smoke scripts.
def _split_output(raw_output: str) -> tuple[str, str]:
    return chat.split_output(raw_output)


def _build_session_title_prompt(first_user_text: str) -> str:
    return title_generator.build_session_title_prompt(first_user_text)


def _normalize_session_title(value: str) -> str | None:
    return title_generator.normalize_session_title(value)


def _resolve_title_generation_model(model_id: str | None):
    if not model_id:
        return None
    return get_model_provider_by_id(project_root, model_id)


async def _run_title_generation_turn(
    *,
    first_user_text: str,
    session_id: str,
    model_entry,
) -> str:
    config_data = build_runtime_config_for_model(project_root, model_entry)
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
        return await runtime.run_turn(
            _build_session_title_prompt(first_user_text),
            session_id=f"{session_id}:title",
            config_path=temp_config_path,
        )
    finally:
        temp_config_path.unlink(missing_ok=True)


async def _generate_session_title(
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    if not first_user_text.strip():
        session_store.mark_title_generation_done(session.session_id)
        return

    model_entry = _resolve_title_generation_model(title_model_id)
    if model_entry is None:
        session_store.mark_title_generation_done(session.session_id)
        return

    try:
        raw_title = await _run_title_generation_turn(
            first_user_text=first_user_text,
            session_id=session.session_id,
            model_entry=model_entry,
        )
        title = _normalize_session_title(raw_title)
        session_store.set_title(session.session_id, title)
        session_metadata_store.set_title(session.session_id, title)
    except Exception:
        logger.exception("[title] generation failed for session %s", session.session_id)
    finally:
        session_store.mark_title_generation_done(session.session_id)
        if not session_metadata_store.get(session.session_id).title:
            session_metadata_store.mark_title_generation_done(session.session_id)


def _schedule_session_title_generation(
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    title_generator.schedule_session_title_generation(
        server_context,
        session,
        first_user_text,
        title_model_id,
    )
