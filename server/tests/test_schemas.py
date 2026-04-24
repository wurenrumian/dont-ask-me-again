from server.schemas import (
    InvokeRequest,
    InvokeSuccessResponse,
    ProviderConfigRequest,
    ResponsesRequest,
)


def test_request_accepts_expected_shape() -> None:
    payload = InvokeRequest.model_validate(
        {
            "request_id": "req-1",
            "session_id": None,
            "title_generation_model_id": "model-1",
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "entropy",
                "instruction": "Explain this.",
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"},
        }
    )

    assert payload.input.selection_text == "entropy"
    assert payload.title_generation_model_id == "model-1"


def test_success_response_requires_thinking_and_answer() -> None:
    payload = InvokeSuccessResponse.model_validate(
        {
            "ok": True,
            "result": {
                "session_id": "sess_1",
                "thinking": "Let me think.",
                "answer": "# Answer",
            },
            "error": None,
        }
    )

    assert payload.result.answer == "# Answer"


def test_provider_config_request_accepts_minimax_payload() -> None:
    payload = ProviderConfigRequest.model_validate(
        {
            "provider": "minimax",
            "model": "MiniMax-M2.7",
            "api_base": "https://api.minimaxi.com/v1",
            "api_key": "dummy",
        }
    )

    assert payload.provider == "minimax"


def test_responses_request_accepts_openai_shape() -> None:
    payload = ResponsesRequest.model_validate(
        {
            "model": "gpt-5-codex",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "hello"}]}
            ],
            "stream": True,
            "previous_response_id": "resp_123",
            "title_generation_model_id": "model-1",
        }
    )

    assert payload.stream is True
    assert payload.title_generation_model_id == "model-1"
