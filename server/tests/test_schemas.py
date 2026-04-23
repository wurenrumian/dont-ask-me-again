from server.schemas import InvokeRequest, InvokeSuccessResponse, ProviderConfigRequest


def test_request_accepts_expected_shape() -> None:
    payload = InvokeRequest.model_validate(
        {
            "request_id": "req-1",
            "session_id": None,
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


def test_success_response_requires_filename() -> None:
    payload = InvokeSuccessResponse.model_validate(
        {
            "ok": True,
            "result": {
                "session_id": "sess_1",
                "filename": "entropy-answer",
                "markdown": "# Answer",
            },
            "error": None,
        }
    )

    assert payload.result.filename == "entropy-answer"


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
