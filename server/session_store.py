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

    def get_or_create(self, session_id: str | None) -> SessionRecord:
        if session_id and session_id in self._records:
            record = self._records[session_id]
            record.updated_at = datetime.now(UTC)
            return record

        return self.create()

    def append_turn(self, session_id: str, role: str, content: str) -> None:
        record = self._records[session_id]
        record.history.append({"role": role, "content": content})
        record.updated_at = datetime.now(UTC)
