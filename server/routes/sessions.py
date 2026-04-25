from __future__ import annotations

from fastapi import APIRouter

from server.context import ServerContext
from server.schemas import SessionListResponse
from server.session_catalog import list_nanobot_sessions


def apply_session_titles(ctx: ServerContext, response: SessionListResponse) -> SessionListResponse:
    metadata_titles_by_session_id = ctx.session_metadata_store.titles_by_session_id()
    titles_by_session_id = {
        record.session_id: record.title
        for record in ctx.session_store.list_records()
        if record.title
    }
    titles_by_session_id = {**metadata_titles_by_session_id, **titles_by_session_id}
    if not titles_by_session_id:
        return response

    entries = [
        entry.model_copy(
            update={"title": titles_by_session_id.get(entry.session_id, entry.title)}
        )
        for entry in response.entries
    ]
    return SessionListResponse(entries=entries)


def create_router(ctx: ServerContext) -> APIRouter:
    router = APIRouter()

    @router.get("/api/v1/sessions")
    def list_sessions(limit: int = 100) -> SessionListResponse:
        response = list_nanobot_sessions(ctx.project_root, ctx.settings, limit=limit)
        return apply_session_titles(ctx, response)

    return router
