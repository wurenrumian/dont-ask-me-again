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
