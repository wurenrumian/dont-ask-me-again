from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger("dama.session_metadata")


@dataclass
class SessionMetadata:
    session_id: str
    title: str | None = None
    title_generation_state: str = "pending"
    created_at: str | None = None
    updated_at: str | None = None


class SessionMetadataStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    @classmethod
    def for_project(cls, project_root: Path) -> "SessionMetadataStore":
        return cls((project_root / ".runtime" / "session-metadata.json").resolve())

    def get(self, session_id: str) -> SessionMetadata:
        data = self._read()
        raw = data.get("sessions", {}).get(session_id)
        if not isinstance(raw, dict):
            return SessionMetadata(session_id=session_id)
        return SessionMetadata(
            session_id=session_id,
            title=str(raw["title"]) if raw.get("title") else None,
            title_generation_state=str(raw.get("title_generation_state") or "pending"),
            created_at=str(raw["created_at"]) if raw.get("created_at") else None,
            updated_at=str(raw["updated_at"]) if raw.get("updated_at") else None,
        )

    def set_title(self, session_id: str, title: str | None) -> SessionMetadata:
        metadata = self.get(session_id)
        metadata.title = title
        metadata.title_generation_state = "done"
        return self.save(metadata)

    def mark_title_generation_running(self, session_id: str) -> bool:
        metadata = self.get(session_id)
        if metadata.title_generation_state != "pending":
            return False
        metadata.title_generation_state = "running"
        self.save(metadata)
        return True

    def mark_title_generation_done(self, session_id: str) -> SessionMetadata:
        metadata = self.get(session_id)
        metadata.title_generation_state = "done"
        return self.save(metadata)

    def save(self, metadata: SessionMetadata) -> SessionMetadata:
        data = self._read()
        sessions = data.setdefault("sessions", {})
        if not isinstance(sessions, dict):
            sessions = {}
            data["sessions"] = sessions

        now = datetime.now(UTC).isoformat()
        existing = sessions.get(metadata.session_id)
        created_at = metadata.created_at
        if not created_at and isinstance(existing, dict):
            created_at = str(existing.get("created_at") or "")
        metadata.created_at = created_at or now
        metadata.updated_at = now
        sessions[metadata.session_id] = {
            "title": metadata.title,
            "title_generation_state": metadata.title_generation_state,
            "created_at": metadata.created_at,
            "updated_at": metadata.updated_at,
        }
        self._write(data)
        return metadata

    def titles_by_session_id(self) -> dict[str, str]:
        data = self._read()
        sessions = data.get("sessions", {})
        if not isinstance(sessions, dict):
            return {}
        return {
            session_id: str(raw["title"])
            for session_id, raw in sessions.items()
            if isinstance(raw, dict) and raw.get("title")
        }

    def _read(self) -> dict[str, object]:
        if not self.path.exists():
            return {"sessions": {}}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("[session-metadata] failed to read %s", self.path)
            return {"sessions": {}}
        return raw if isinstance(raw, dict) else {"sessions": {}}

    def _write(self, data: dict[str, object]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")
        temp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(self.path)
