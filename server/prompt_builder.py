from __future__ import annotations

from server.schemas import InvokeRequest
from server.session_store import SessionRecord


def _obsidian_markdown_rules() -> str:
    return (
        "Output rules for Obsidian:\n"
        "- The final answer must be valid Markdown suitable for direct insertion into a note.\n"
        "- Do not wrap the entire answer in a single fenced code block unless the user explicitly asks.\n"
        "- For inline math, use MathJax inline form: $...$.\n"
        "- For block math, use MathJax block form on separate lines: $$...$$.\n"
        "- Do not use \\(...\\) or \\[...\\] delimiters.\n"
    )


def build_runtime_prompt(payload: InvokeRequest, session: SessionRecord) -> str:
    selection_block = (
        f"Selected text:\n{payload.input.selection_text}\n\n"
        if payload.input.selection_text.strip()
        else ""
    )

    return (
        "You are generating an Obsidian note from the current file context.\n"
        "Return only a JSON object with keys filename and markdown.\n\n"
        f"{_obsidian_markdown_rules()}\n"
        f"Source file path:\n{payload.input.active_file_path}\n\n"
        f"Source file content:\n{payload.input.active_file_content}\n\n"
        f"{selection_block}"
        f"Instruction:\n{payload.input.instruction}\n"
    )


def build_chat_prompt(payload: InvokeRequest, session: SessionRecord) -> str:
    selection_block = (
        f"Selected text in current file:\n{payload.input.selection_text}\n\n"
        if payload.input.selection_text.strip()
        else ""
    )

    tool_call_rule = "Do not use tool calls.\n"
    image_generation_block = ""
    if payload.image_generation and payload.image_generation.enabled:
        tool_call_rule = "Do not use tool calls except generate_image when image generation is needed.\n"
        image_generation_block = _image_generation_rules(payload.image_generation)

    return (
        "You are an assistant chatting inside Obsidian for one active note.\n"
        "The active note is already referenced as @active_file below.\n"
        f"{tool_call_rule}"
        "Do not output JSON.\n"
        "Always output TWO XML-style sections in this exact order:\n"
        "<thinking>...</thinking>\n"
        "<answer>...</answer>\n"
        "Both sections must be present.\n"
        f"{image_generation_block}"
        f"{_obsidian_markdown_rules()}\n"
        f"@active_file path:\n{payload.input.active_file_path}\n\n"
        f"@active_file content:\n{payload.input.active_file_content}\n\n"
        f"{selection_block}"
        f"User instruction:\n{payload.input.instruction}\n"
    )


def _image_generation_rules(image_generation) -> str:
    if not image_generation or not image_generation.enabled:
        return ""
    max_images = image_generation.max_images
    return (
        "Image generation permission for this request is enabled.\n"
        "If the user asks for images, call the generate_image tool.\n"
        f"You may generate max {max_images} image(s) in this request.\n"
        "Each generate_image call must include prompt and filename.\n"
        "The filename must be short, concrete, unique in this answer, and must not include a path or extension.\n"
        "When you reference a generated image in the final answer, use Obsidian embed syntax exactly like ![[filename.png]].\n\n"
    )


def build_responses_prompt(instruction: str, session: SessionRecord, image_generation=None) -> str:
    return (
        "You are a coding assistant responding to a Responses API client.\n"
        "Return plain helpful text. If you need internal reasoning, keep it brief.\n"
        f"{_image_generation_rules(image_generation)}"
        f"{_obsidian_markdown_rules()}\n"
        f"User input:\n{instruction.strip()}\n"
    )
