from fastapi.testclient import TestClient

from server import app as app_module


client = TestClient(app_module.app)


def test_invoke_returns_normalized_success(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        assert "entropy" in prompt
        return '{"filename":"entropy-answer","markdown":"# Answer"}'

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
    assert body["result"]["filename"] == "entropy-answer"
    assert body["result"]["markdown"] == "# Answer"
    assert body["result"]["session_id"].startswith("sess_")


def test_invoke_returns_invalid_agent_output(monkeypatch) -> None:
    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "not-json"

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
    assert body["error"]["code"] == "INVALID_AGENT_OUTPUT"
