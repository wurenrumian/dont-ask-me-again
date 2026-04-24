from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4


@dataclass
class SessionRecord:
    session_id: str
    created_at: datetime
    updated_at: datetime
    history: list[dict[str, str]] = field(default_factory=list)
    title: str | None = None
    title_generation_state: str = "pending"


class InMemorySessionStore:
    def __init__(self) -> None:
        self._records: dict[str, SessionRecord] = {}

    def create(self) -> SessionRecord:
        now = datetime.now(UTC)
        record = SessionRecord(
            session_id=f"sess_{uuid4().hex}",
            created_at=now,
            updated_at=now,
        )
        self._records[record.session_id] = record
        return record

    def create_with_id(self, session_id: str) -> SessionRecord:
        now = datetime.now(UTC)
        record = SessionRecord(
            session_id=session_id,
            created_at=now,
            updated_at=now,
        )
        self._records[record.session_id] = record
        return record

    def get(self, session_id: str) -> SessionRecord:
        return self._records[session_id]

    def get_or_create(self, session_id: str | None) -> tuple[SessionRecord, bool]:
        if session_id and session_id in self._records:
            record = self._records[session_id]
            record.updated_at = datetime.now(UTC)
            return record, False

        if session_id:
            return self.create_with_id(session_id), True

        return self.create(), True

    def list_records(self) -> list[SessionRecord]:
        return list(self._records.values())

    def append_turn(self, session_id: str, role: str, content: str) -> None:
        record = self._records[session_id]
        record.history.append({"role": role, "content": content})
        record.updated_at = datetime.now(UTC)

    def set_title(self, session_id: str, title: str | None) -> None:
        record = self._records[session_id]
        record.title = title
        record.updated_at = datetime.now(UTC)

    def try_mark_title_generation_running(self, session_id: str) -> bool:
        record = self._records[session_id]
        if record.title_generation_state != "pending":
            return False
        record.title_generation_state = "running"
        record.updated_at = datetime.now(UTC)
        return True

    def mark_title_generation_done(self, session_id: str) -> None:
        record = self._records[session_id]
        record.title_generation_state = "done"
        record.updated_at = datetime.now(UTC)
