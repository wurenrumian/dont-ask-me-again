from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from server.config import ServerSettings
from server.runtime.nanobot_adapter import NanobotAdapter
from server.session_metadata_store import SessionMetadataStore
from server.session_store import InMemorySessionStore


@dataclass
class ServerContext:
    project_root: Path
    settings: ServerSettings
    session_store: InMemorySessionStore
    session_metadata_store: SessionMetadataStore
    runtime: NanobotAdapter
    logger: logging.Logger
    responses_session_index: dict[str, str] = field(default_factory=dict)
