from fastapi.testclient import TestClient

from server import app as app_module
from server.routes import chat as chat_routes


client = TestClient(app_module.app)


def test_invoke_returns_normalized_success(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        assert "entropy" in prompt
        return "<thinking>Let me think.</thinking><answer># Answer</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)

    response = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": None,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "entropy",
                "instruction": "Explain this."
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["result"]["thinking"] == "Let me think."
    assert body["result"]["answer"] == "# Answer"
    assert body["result"]["session_id"].startswith("sess_")


def test_invoke_accepts_plain_text_without_tags(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "plain answer text"

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)

    response = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": None,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Explain this."
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["result"]["thinking"] == ""
    assert body["result"]["answer"] == "plain answer text"


def test_invoke_returns_config_error_when_runtime_config_missing(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        raise FileNotFoundError("nanobot config not found")

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)

    response = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": None,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Explain this."
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CONFIG_ERROR"
    assert body["error"]["retryable"] is False


def test_chat_stream_emits_reasoning_and_answer_events(monkeypatch) -> None:
    async def fake_run_turn_stream(prompt: str, session_id: str, on_delta) -> str:
        await on_delta("<thinking>reasoning ")
        await on_delta("step</thinking><answer>final ")
        await on_delta("reply</answer>")
        return "<thinking>reasoning step</thinking><answer>final reply</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn_stream", fake_run_turn_stream)

    with client.stream(
        "POST",
        "/api/v1/chat/stream",
        json={
            "request_id": "req-stream-1",
            "session_id": None,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Say hi."
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: session" in body
    assert "event: thinking_delta" in body
    assert "reasoning step" in body
    assert "event: answer_delta" in body
    assert "final reply" in body
    assert "event: done" in body


def test_split_output_preserves_markdown_spacing_inside_answer_tags() -> None:
    thinking, answer = chat_routes.split_output(
        "<thinking>\nplan\n</thinking><answer>\n\n# Title\n\n- item\n</answer>"
    )

    assert thinking == "\nplan\n"
    assert answer == "\n\n# Title\n\n- item\n"


def test_chat_stream_forwards_generated_image_events(monkeypatch) -> None:
    async def fake_run_turn_stream(
        prompt: str,
        session_id: str,
        on_delta,
        *,
        image_generation=None,
        on_image=None,
    ) -> str:
        assert image_generation is not None
        assert image_generation.enabled is True
        assert image_generation.max_images == 2
        assert on_image is not None
        await on_image(
            {
                "filename": "cover",
                "mime_type": "image/png",
                "base64": "aGVsbG8=",
            }
        )
        await on_delta("<answer>![[cover.png]]</answer>")
        return "<thinking></thinking><answer>![[cover.png]]</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn_stream", fake_run_turn_stream)

    with client.stream(
        "POST",
        "/api/v1/chat/stream",
        json={
            "request_id": "req-stream-1",
            "session_id": None,
            "image_generation": {
                "enabled": True,
                "model_id": "image-model-1",
                "max_images": 2,
            },
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Generate a cover.",
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"},
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: image_generated" in body
    assert '"filename": "cover"' in body
    assert '"base64": "aGVsbG8="' in body
    assert "event: answer_delta" in body


def test_list_sessions_reads_nanobot_workspace(monkeypatch, tmp_path) -> None:
    workspace = tmp_path / "nanobot-workspace"
    sessions = workspace / "sessions"
    sessions.mkdir(parents=True)

    old_file = sessions / "dont-ask-me-again_sess_old.jsonl"
    old_file.write_text("old", encoding="utf-8")
    new_file = sessions / "dont-ask-me-again_sess_new.jsonl"
    new_file.write_text("new", encoding="utf-8")
    unrelated = sessions / "other_sess_skip.jsonl"
    unrelated.write_text("skip", encoding="utf-8")

    old_ts = 1710000000
    new_ts = 1720000000
    import os

    os.utime(old_file, (old_ts, old_ts))
    os.utime(new_file, (new_ts, new_ts))

    monkeypatch.setattr(app_module.settings, "nanobot_workspace", str(workspace))
    monkeypatch.setattr(app_module.settings, "nanobot_session_prefix", "dont-ask-me-again")

    response = client.get("/api/v1/sessions?limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert [entry["session_id"] for entry in body["entries"]] == [
        "sess_new",
        "sess_old",
    ]


def test_list_sessions_includes_in_memory_title(monkeypatch, tmp_path) -> None:
    workspace = tmp_path / "nanobot-workspace"
    sessions = workspace / "sessions"
    sessions.mkdir(parents=True)

    session_file = sessions / "dont-ask-me-again_sess_with_title.jsonl"
    session_file.write_text("x", encoding="utf-8")

    monkeypatch.setattr(app_module.settings, "nanobot_workspace", str(workspace))
    monkeypatch.setattr(app_module.settings, "nanobot_session_prefix", "dont-ask-me-again")

    app_module.session_store.get_or_create("sess_with_title")
    app_module.session_store.set_title("sess_with_title", "First turn summary")

    response = client.get("/api/v1/sessions?limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body["entries"][0]["session_id"] == "sess_with_title"
    assert body["entries"][0]["title"] == "First turn summary"


def test_new_session_first_request_starts_title_generation_once(monkeypatch) -> None:
    scheduled: list[tuple[str, str, str | None]] = []

    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "ok"

    def fake_schedule(ctx, session, first_user_text: str, title_model_id: str | None) -> None:
        scheduled.append((session.session_id, first_user_text, title_model_id))

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)
    monkeypatch.setattr(chat_routes, "schedule_session_title_generation", fake_schedule)

    response = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": None,
            "title_generation_model_id": "model-1",
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Draft a changelog summary",
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"},
        },
    )

    assert response.status_code == 200
    assert scheduled == [
        (response.json()["result"]["session_id"], "Draft a changelog summary", "model-1")
    ]


def test_existing_session_does_not_retry_title_generation(monkeypatch) -> None:
    seen_calls: list[str] = []
    session = app_module.session_store.create()

    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "ok"

    def fake_schedule(ctx, session_record, first_user_text: str, title_model_id: str | None) -> None:
        seen_calls.append(session_record.session_id)

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)
    monkeypatch.setattr(chat_routes, "schedule_session_title_generation", fake_schedule)

    first = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": session.session_id,
            "title_generation_model_id": "model-1",
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "first",
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"},
        },
    )
    second = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-2",
            "session_id": first.json()["result"]["session_id"],
            "title_generation_model_id": "model-1",
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "second",
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"},
        },
    )

    assert second.status_code == 200
    assert seen_calls == []


def test_generate_title_normalizes_and_stores_result(monkeypatch) -> None:
    session = app_module.session_store.create()
    app_module.session_store.append_turn(session.session_id, "user", "Explain provider sync")

    monkeypatch.setattr(
        app_module,
        "_resolve_title_generation_model",
        lambda model_id: {
            "id": model_id,
            "provider": "openai",
            "model": "gpt-5.4-mini",
            "api_base": None,
        },
    )

    async def fake_run_title_turn(
        *, first_user_text: str, session_id: str, model_entry: dict[str, str | None]
    ) -> str:
        assert "Explain provider sync" in first_user_text
        assert session_id == session.session_id
        assert model_entry["id"] == "model-1"
        return '  "Provider sync flow"  '

    monkeypatch.setattr(app_module, "_run_title_generation_turn", fake_run_title_turn)

    import asyncio

    asyncio.run(app_module._generate_session_title(session, "Explain provider sync", "model-1"))

    stored = app_module.session_store.get(session.session_id)
    assert stored.title == "Provider sync flow"
    assert stored.title_generation_state == "done"


def test_generate_title_skips_when_model_not_configured() -> None:
    session = app_module.session_store.create()

    import asyncio

    asyncio.run(app_module._generate_session_title(session, "Hello", None))

    stored = app_module.session_store.get(session.session_id)
    assert stored.title is None
    assert stored.title_generation_state == "done"


def test_build_session_title_prompt_requests_short_chinese_title() -> None:
    prompt = app_module._build_session_title_prompt("帮我整理 provider config 的同步流程")

    assert "10个字左右" in prompt
    assert "中文标题" in prompt
    assert "只返回标题文本" in prompt
    assert "帮我整理 provider config 的同步流程" in prompt


def test_openai_responses_returns_completed_object(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        assert "Write a function" in prompt
        return "<thinking>plan</thinking><answer>done</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)

    response = client.post(
        "/v1/responses",
        json={
            "model": "gpt-5-codex",
            "input": "Write a function",
            "stream": False,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "response"
    assert body["status"] == "completed"
    assert body["output_text"] == "done"
    assert body["metadata"]["session_id"].startswith("sess_")
    assert body["id"].startswith("resp_")


def test_openai_responses_stream_emits_delta_and_completed(monkeypatch) -> None:
    async def fake_run_turn_stream(prompt: str, session_id: str, on_delta) -> str:
        await on_delta("<thinking>x</thinking><answer>hello ")
        await on_delta("world</answer>")
        return "<thinking>x</thinking><answer>hello world</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn_stream", fake_run_turn_stream)

    with client.stream(
        "POST",
        "/v1/responses",
        json={
            "model": "gpt-5-codex",
            "input": "stream please",
            "stream": True,
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: response.created" in body
    assert "event: response.output_text.delta" in body
    assert "hello world" in body
    assert "event: response.completed" in body


def test_openai_responses_stream_preserves_leading_blank_lines_in_completed_answer(
    monkeypatch,
) -> None:
    async def fake_run_turn_stream(prompt: str, session_id: str, on_delta) -> str:
        await on_delta("<answer>\n\n# Title\nBody</answer>")
        return "<thinking></thinking><answer>\n\n# Title\nBody</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn_stream", fake_run_turn_stream)

    with client.stream(
        "POST",
        "/v1/responses",
        json={
            "model": "gpt-5-codex",
            "input": "stream please",
            "stream": True,
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"text": "\\n\\n# Title\\nBody"' in body
    assert '"output_text": "\\n\\n# Title\\nBody"' in body


def test_openai_responses_stream_forwards_generated_image_events(monkeypatch) -> None:
    async def fake_run_turn_stream(
        prompt: str,
        session_id: str,
        on_delta,
        *,
        image_generation=None,
        on_image=None,
    ) -> str:
        assert "generate_image" in prompt
        assert image_generation is not None
        assert image_generation.enabled is True
        assert image_generation.max_images == 2
        assert on_image is not None
        await on_image(
            {
                "filename": "cover",
                "mime_type": "image/png",
                "base64": "aGVsbG8=",
            }
        )
        await on_delta("<answer>![[cover.png]]</answer>")
        return "<thinking></thinking><answer>![[cover.png]]</answer>"

    monkeypatch.setattr(app_module.runtime, "run_turn_stream", fake_run_turn_stream)

    with client.stream(
        "POST",
        "/v1/responses",
        json={
            "model": "gpt-5-codex",
            "input": "generate an image",
            "stream": True,
            "image_generation": {
                "enabled": True,
                "model_id": "image-model-1",
                "max_images": 2,
            },
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: image_generated" in body
    assert '"filename": "cover"' in body
    assert '"base64": "aGVsbG8="' in body
    assert "event: response.output_text.delta" in body


def test_openai_responses_previous_response_id_reuses_session(monkeypatch) -> None:
    seen_sessions: list[str] = []

    async def fake_run_turn(prompt: str, session_id: str) -> str:
        seen_sessions.append(session_id)
        return "ok"

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)

    first = client.post(
        "/v1/responses",
        json={"model": "gpt-5-codex", "input": "first"},
    )
    first_id = first.json()["id"]

    second = client.post(
        "/v1/responses",
        json={
            "model": "gpt-5-codex",
            "input": "second",
            "previous_response_id": first_id,
        },
    )

    assert second.status_code == 200
    assert len(seen_sessions) == 2
    assert seen_sessions[0] == seen_sessions[1]
