from datetime import UTC, datetime

from server.prompt_builder import build_chat_prompt, build_responses_prompt, build_runtime_prompt
from server.schemas import ImageGenerationOptions, InvokeRequest
from server.session_store import SessionRecord


def _invoke_request() -> InvokeRequest:
    return InvokeRequest(
        request_id="req-1",
        session_id="sess_1",
        input={
            "active_file_path": "note.md",
            "active_file_content": "# Note",
            "selection_text": "",
            "instruction": "Explain this",
        },
        client={"name": "dont-ask-me-again", "version": "0.1.0"},
    )


def _invoke_request_with_image_generation() -> InvokeRequest:
    return InvokeRequest(
        request_id="req-1",
        session_id="sess_1",
        image_generation={
            "enabled": True,
            "model_id": "image-model-1",
            "max_images": 3,
        },
        input={
            "active_file_path": "note.md",
            "active_file_content": "# Note",
            "selection_text": "",
            "instruction": "Generate a cover image",
        },
        client={"name": "dont-ask-me-again", "version": "0.1.0"},
    )


def _session_with_history() -> SessionRecord:
    now = datetime.now(UTC)
    return SessionRecord(
        session_id="sess_1",
        created_at=now,
        updated_at=now,
        history=[
            {"role": "user", "content": "old user message"},
            {"role": "assistant", "content": "old assistant message"},
        ],
    )


def test_chat_prompt_does_not_inline_session_history() -> None:
    prompt = build_chat_prompt(_invoke_request(), _session_with_history())

    assert "Session history:" not in prompt
    assert "old user message" not in prompt
    assert "User instruction:\nExplain this" in prompt


def test_chat_prompt_includes_image_generation_tool_rules_when_enabled() -> None:
    prompt = build_chat_prompt(_invoke_request_with_image_generation(), _session_with_history())

    assert "generate_image" in prompt
    assert "![[filename.png]]" in prompt
    assert "max 3 image" in prompt


def test_responses_prompt_does_not_inline_session_history() -> None:
    prompt = build_responses_prompt("new input", _session_with_history())

    assert "Session history:" not in prompt
    assert "old assistant message" not in prompt
    assert "User input:\nnew input" in prompt


def test_responses_prompt_includes_image_generation_tool_rules_when_enabled() -> None:
    prompt = build_responses_prompt(
        "generate an image",
        _session_with_history(),
        ImageGenerationOptions(enabled=True, model_id="image-model-1", max_images=2),
    )

    assert "generate_image" in prompt
    assert "![[filename.png]]" in prompt
    assert "max 2 image" in prompt


def test_runtime_prompt_does_not_inline_session_history() -> None:
    prompt = build_runtime_prompt(_invoke_request(), _session_with_history())

    assert "Session history:" not in prompt
    assert "old user message" not in prompt
    assert "Instruction:\nExplain this" in prompt
