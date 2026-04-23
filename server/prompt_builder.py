from __future__ import annotations

from server.schemas import InvokeRequest
from server.session_store import SessionRecord


def build_runtime_prompt(payload: InvokeRequest, session: SessionRecord) -> str:
    selection_block = (
        f"Selected text:\n{payload.input.selection_text}\n\n"
        if payload.input.selection_text.strip()
        else ""
    )

    history_block = ""
    if session.history:
        rendered_history = "\n".join(
            f"{item['role']}: {item['content']}" for item in session.history[-6:]
        )
        history_block = f"Session history:\n{rendered_history}\n\n"

    return (
        "You are generating an Obsidian note from the current file context.\n"
        "Return only a JSON object with keys filename and markdown.\n\n"
        f"Source file path:\n{payload.input.active_file_path}\n\n"
        f"Source file content:\n{payload.input.active_file_content}\n\n"
        f"{selection_block}"
        f"{history_block}"
        f"Instruction:\n{payload.input.instruction}\n"
    )


def build_chat_prompt(payload: InvokeRequest, session: SessionRecord) -> str:
    selection_block = (
        f"Selected text in current file:\n{payload.input.selection_text}\n\n"
        if payload.input.selection_text.strip()
        else ""
    )

    history_block = ""
    if session.history:
        rendered_history = "\n".join(
            f"{item['role']}: {item['content']}" for item in session.history[-8:]
        )
        history_block = f"Session history:\n{rendered_history}\n\n"

    return (
        "You are an assistant chatting inside Obsidian for one active note.\n"
        "The active note is already referenced as @active_file below.\n"
        "Do not use tool calls. Do not output JSON.\n"
        "Always output TWO XML-style sections in this exact order:\n"
        "<thinking>...</thinking>\n"
        "<answer>...</answer>\n"
        "Both sections must be present. answer must be markdown suitable to append into the note.\n\n"
        f"@active_file path:\n{payload.input.active_file_path}\n\n"
        f"@active_file content:\n{payload.input.active_file_content}\n\n"
        f"{selection_block}"
        f"{history_block}"
        f"User instruction:\n{payload.input.instruction}\n"
    )
