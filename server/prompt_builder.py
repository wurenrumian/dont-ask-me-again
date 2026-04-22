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
