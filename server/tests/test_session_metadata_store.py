from server.session_metadata_store import SessionMetadataStore
from pathlib import Path
from uuid import uuid4


def _metadata_path() -> Path:
    directory = Path(".tmp-test-data") / f"session-metadata-{uuid4().hex}"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "metadata.json"


def test_session_metadata_store_persists_title() -> None:
    path = _metadata_path()
    store = SessionMetadataStore(path)

    store.set_title("sess_1", "整理配置同步")

    reloaded = SessionMetadataStore(path)
    metadata = reloaded.get("sess_1")
    assert metadata.title == "整理配置同步"
    assert metadata.title_generation_state == "done"
    assert metadata.created_at is not None
    assert metadata.updated_at is not None


def test_session_metadata_store_overwrites_title() -> None:
    store = SessionMetadataStore(_metadata_path())

    store.set_title("sess_1", "旧标题")
    store.set_title("sess_1", "新标题")

    assert store.get("sess_1").title == "新标题"
    assert store.titles_by_session_id() == {"sess_1": "新标题"}


def test_session_metadata_store_handles_missing_file() -> None:
    store = SessionMetadataStore(_metadata_path())

    metadata = store.get("sess_missing")

    assert metadata.session_id == "sess_missing"
    assert metadata.title is None
    assert metadata.title_generation_state == "pending"
