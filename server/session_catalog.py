from __future__ import annotations

from pathlib import Path

from server.config import ServerSettings
from server.schemas import SessionEntry, SessionListResponse


def list_nanobot_sessions(
    project_root: Path,
    settings: ServerSettings,
    limit: int = 100,
) -> SessionListResponse:
    workspace = settings.resolve_workspace(project_root)
    sessions_dir = workspace / "sessions"
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return SessionListResponse(entries=[])

    prefix = settings.nanobot_session_prefix
    normalized_limit = max(1, min(limit, 500))
    candidates: list[tuple[float, SessionEntry]] = []

    for file_path in sessions_dir.glob("*.jsonl"):
        session_id = _extract_session_id(file_path, prefix)
        if not session_id:
            continue
        stat = file_path.stat()
        updated_at = _to_iso_utc(stat.st_mtime)
        candidates.append(
            (
                stat.st_mtime,
                SessionEntry(session_id=session_id, updated_at=updated_at),
            )
        )

    candidates.sort(key=lambda item: item[0], reverse=True)
    return SessionListResponse(entries=[entry for _, entry in candidates[:normalized_limit]])


def _extract_session_id(file_path: Path, prefix: str) -> str | None:
    stem = file_path.stem
    expected_prefix = f"{prefix}_"
    if not stem.startswith(expected_prefix):
        return None
    remainder = stem[len(expected_prefix) :]
    if not remainder.startswith("sess_"):
        return None
    return remainder


def _to_iso_utc(timestamp: float) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat()
