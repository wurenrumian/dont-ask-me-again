from fastapi.testclient import TestClient

from server import app as app_module
from server.schemas import ProviderConfigResult


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


def test_provider_config_endpoint_returns_saved_summary(monkeypatch) -> None:
    def fake_apply_provider_config(project_root, payload) -> ProviderConfigResult:
        assert payload.provider == "minimax"
        return ProviderConfigResult(
            provider="minimax",
            model="MiniMax-M2.7",
            api_base="https://api.minimaxi.com/v1",
            api_key_env="MINIMAX_API_KEY",
            has_api_key=True,
        )

    monkeypatch.setattr(app_module, "apply_provider_config", fake_apply_provider_config)

    response = client.post(
        "/api/v1/provider-config",
        json={
            "provider": "minimax",
            "model": "MiniMax-M2.7",
            "api_base": "https://api.minimaxi.com/v1",
            "api_key": "dummy-key",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["result"]["provider"] == "minimax"
    assert body["result"]["api_key_env"] == "MINIMAX_API_KEY"


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
