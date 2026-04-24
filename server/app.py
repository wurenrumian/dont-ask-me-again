from __future__ import annotations

import asyncio
import json
import logging
import re
import tempfile
import time
from uuid import uuid4
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from server.config import ServerSettings, load_runtime_env
from server.provider_config_store import (
    apply_provider_config,
    build_runtime_config_for_model,
    delete_model_provider,
    ensure_runtime_config_synced,
    get_model_provider_by_id,
    list_model_providers,
    save_model_provider,
)
from server.prompt_builder import build_chat_prompt, build_responses_prompt
from server.runtime.nanobot_adapter import NanobotAdapter
from server.schemas import (
    ErrorDetail,
    InvokeErrorResponse,
    InvokeRequest,
    InvokeSuccessResponse,
    ModelProviderDeleteRequest,
    ModelProviderDeleteResponse,
    ModelProviderListResponse,
    ModelProviderSaveRequest,
    ModelProviderSaveResponse,
    ProviderConfigErrorResponse,
    ProviderConfigRequest,
    ProviderConfigSuccessResponse,
    ResponsesRequest,
    SessionListResponse,
)
from server.session_catalog import list_nanobot_sessions
from server.session_store import InMemorySessionStore
from server.session_store import SessionRecord

app = FastAPI(title="dont-ask-me-again-server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

project_root = Path(__file__).resolve().parent.parent
load_runtime_env(project_root)
settings = ServerSettings()
session_store = InMemorySessionStore()
runtime = NanobotAdapter(project_root=project_root, settings=settings)
ensure_runtime_config_synced(project_root)
logger = logging.getLogger("dama.server")
responses_session_index: dict[str, str] = {}

_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL | re.IGNORECASE)
_ANSWER_RE = re.compile(r"<answer>(.*?)</answer>", re.DOTALL | re.IGNORECASE)


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/invoke")
async def invoke(payload: InvokeRequest) -> InvokeSuccessResponse | InvokeErrorResponse:
    ensure_runtime_config_synced(project_root)
    session, created = session_store.get_or_create(payload.session_id)
    session_store.append_turn(session.session_id, "user", payload.input.instruction)
    if created:
        _schedule_session_title_generation(
            session,
            payload.input.instruction,
            payload.title_generation_model_id,
        )
    prompt = build_chat_prompt(payload, session)

    try:
        raw_output = await runtime.run_turn(prompt, session.session_id)
        thinking, answer = _split_output(raw_output)
        result = {
            "session_id": session.session_id,
            "thinking": thinking,
            "answer": answer,
        }
        session_store.append_turn(
            session.session_id,
            "assistant",
            f"<thinking>{thinking}</thinking>\n<answer>{answer}</answer>",
        )
        return InvokeSuccessResponse(result=result)
    except FileNotFoundError as error:
        return InvokeErrorResponse(
            error=ErrorDetail(
                code="CONFIG_ERROR",
                message=str(error),
                retryable=False,
            )
        )
    except Exception as error:
        return InvokeErrorResponse(
            error=ErrorDetail(
                code="MODEL_ERROR",
                message=str(error),
                retryable=True,
            )
        )


def _to_sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _normalize_session_title(value: str) -> str | None:
    normalized = " ".join(value.strip().strip("\"'").split())
    if not normalized:
        return None
    trimmed = normalized[:80].rstrip(" .,:;!?-")
    return trimmed or None


def _build_session_title_prompt(first_user_text: str) -> str:
    return (
        "请根据用户的第一条请求，生成一个10个字左右的中文标题。\n"
        "只返回标题文本。\n"
        "不要返回引号、序号、解释、标签、Markdown 或句号。\n"
        "标题要具体，适合作为会话名称。\n\n"
        f"用户请求：\n{first_user_text.strip()}"
    )


def _resolve_title_generation_model(model_id: str | None):
    if not model_id:
        return None
    return get_model_provider_by_id(project_root, model_id)


async def _run_title_generation_turn(
    *,
    first_user_text: str,
    session_id: str,
    model_entry,
) -> str:
    config_data = build_runtime_config_for_model(project_root, model_entry)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".json",
        delete=False,
    ) as handle:
        temp_config_path = Path(handle.name)
        json.dump(config_data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    try:
        return await runtime.run_turn(
            _build_session_title_prompt(first_user_text),
            session_id=f"{session_id}:title",
            config_path=temp_config_path,
        )
    finally:
        temp_config_path.unlink(missing_ok=True)


async def _generate_session_title(
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    if not first_user_text.strip():
        session_store.mark_title_generation_done(session.session_id)
        return

    model_entry = _resolve_title_generation_model(title_model_id)
    if model_entry is None:
        session_store.mark_title_generation_done(session.session_id)
        return

    try:
        raw_title = await _run_title_generation_turn(
            first_user_text=first_user_text,
            session_id=session.session_id,
            model_entry=model_entry,
        )
        session_store.set_title(session.session_id, _normalize_session_title(raw_title))
    except Exception:
        logger.exception("[title] generation failed for session %s", session.session_id)
    finally:
        session_store.mark_title_generation_done(session.session_id)


def _schedule_session_title_generation(
    session: SessionRecord,
    first_user_text: str,
    title_model_id: str | None,
) -> None:
    if not session_store.try_mark_title_generation_running(session.session_id):
        return
    asyncio.create_task(_generate_session_title(session, first_user_text, title_model_id))


def _apply_in_memory_titles(response: SessionListResponse) -> SessionListResponse:
    titles_by_session_id = {
        record.session_id: record.title
        for record in session_store.list_records()
        if record.title
    }
    if not titles_by_session_id:
        return response

    entries = [
        entry.model_copy(
            update={"title": titles_by_session_id.get(entry.session_id, entry.title)}
        )
        for entry in response.entries
    ]
    return SessionListResponse(entries=entries)


def _split_output(raw_output: str) -> tuple[str, str]:
    thinking_match = _THINKING_RE.search(raw_output)
    answer_match = _ANSWER_RE.search(raw_output)

    thinking = thinking_match.group(1).strip() if thinking_match else ""
    answer = answer_match.group(1).strip() if answer_match else raw_output.strip()
    return thinking, answer


def _chunk_text(value: str, size: int = 120) -> list[str]:
    if not value:
        return []
    return [value[i : i + size] for i in range(0, len(value), size)]


def _extract_responses_input_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [_extract_responses_input_text(item) for item in value]
        return "\n".join(part.strip() for part in parts if part and part.strip())
    if isinstance(value, dict):
        if "content" in value:
            role = str(value.get("role", "")).strip()
            content_text = _extract_responses_input_text(value.get("content"))
            if role and content_text:
                return f"{role}: {content_text}"
            return content_text

        item_type = str(value.get("type", "")).strip().lower()
        if item_type in {"input_text", "output_text", "text"}:
            text_value = value.get("text")
            return text_value if isinstance(text_value, str) else str(text_value or "")

        if "text" in value:
            text_value = value.get("text")
            return text_value if isinstance(text_value, str) else str(text_value or "")

        parts = [_extract_responses_input_text(entry) for entry in value.values()]
        return "\n".join(part.strip() for part in parts if part and part.strip())
    return str(value)


def _resolve_session_id_for_responses(payload: ResponsesRequest) -> str | None:
    metadata_session = None
    if isinstance(payload.metadata, dict):
        raw = payload.metadata.get("session_id")
        if isinstance(raw, str) and raw.strip():
            metadata_session = raw.strip()

    previous_session = None
    if payload.previous_response_id:
        previous_session = responses_session_index.get(payload.previous_response_id)

    return payload.session_id or metadata_session or previous_session


def _build_responses_completed_object(
    response_id: str,
    model: str | None,
    answer: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message_id = f"msg_{uuid4().hex}"
    content = {
        "type": "output_text",
        "text": answer,
        "annotations": [],
    }
    return {
        "id": response_id,
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "model": model or "",
        "error": None,
        "incomplete_details": None,
        "output": [
            {
                "id": message_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [content],
            }
        ],
        "output_text": answer,
        "metadata": metadata or {},
    }


class _TaggedStreamParser:
    """Incrementally parse <thinking>/<answer> tagged output into typed deltas."""

    def __init__(self) -> None:
        self._buffer = ""
        self._mode: str | None = None
        self._holdback = 16
        self._seen_tag = False

    def feed(self, delta: str) -> list[tuple[str, str]]:
        if not delta:
            return []
        self._buffer += delta
        return self._drain(final=False)

    def flush(self) -> list[tuple[str, str]]:
        return self._drain(final=True)

    def _emit(self, kind: str, text: str, out: list[tuple[str, str]]) -> None:
        if text:
            out.append((kind, text))

    def _drain(self, final: bool) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        while True:
            if self._mode is None:
                idx_th = self._buffer.find("<thinking>")
                idx_ans = self._buffer.find("<answer>")
                indices = [i for i in [idx_th, idx_ans] if i >= 0]
                if not indices:
                    if final:
                        self._emit("answer_delta", self._buffer, out)
                        self._buffer = ""
                    else:
                        safe_len = max(0, len(self._buffer) - self._holdback)
                        if safe_len > 0:
                            self._emit("answer_delta", self._buffer[:safe_len], out)
                            self._buffer = self._buffer[safe_len:]
                    break

                next_idx = min(indices)
                if next_idx > 0:
                    prefix = self._buffer[:next_idx]
                    if not (not self._seen_tag and prefix.strip() == ""):
                        self._emit("answer_delta", prefix, out)
                    self._buffer = self._buffer[next_idx:]

                if self._buffer.startswith("<thinking>"):
                    self._seen_tag = True
                    self._mode = "thinking"
                    self._buffer = self._buffer[len("<thinking>") :]
                    continue
                if self._buffer.startswith("<answer>"):
                    self._seen_tag = True
                    self._mode = "answer"
                    self._buffer = self._buffer[len("<answer>") :]
                    continue
                break

            if self._mode == "thinking":
                end_idx = self._buffer.find("</thinking>")
                if end_idx >= 0:
                    self._emit("thinking_delta", self._buffer[:end_idx], out)
                    self._buffer = self._buffer[end_idx + len("</thinking>") :]
                    self._mode = None
                    continue

                if final:
                    self._emit("thinking_delta", self._buffer, out)
                    self._buffer = ""
                else:
                    safe_len = max(0, len(self._buffer) - self._holdback)
                    if safe_len > 0:
                        self._emit("thinking_delta", self._buffer[:safe_len], out)
                        self._buffer = self._buffer[safe_len:]
                break

            if self._mode == "answer":
                end_idx = self._buffer.find("</answer>")
                if end_idx >= 0:
                    self._emit("answer_delta", self._buffer[:end_idx], out)
                    self._buffer = self._buffer[end_idx + len("</answer>") :]
                    self._mode = None
                    continue

                if final:
                    self._emit("answer_delta", self._buffer, out)
                    self._buffer = ""
                else:
                    safe_len = max(0, len(self._buffer) - self._holdback)
                    if safe_len > 0:
                        self._emit("answer_delta", self._buffer[:safe_len], out)
                        self._buffer = self._buffer[safe_len:]
                break

        return out


@app.post("/api/v1/chat/stream")
async def stream_chat(payload: InvokeRequest) -> StreamingResponse:
    async def event_generator():
        ensure_runtime_config_synced(project_root)
        session, created = session_store.get_or_create(payload.session_id)
        session_store.append_turn(session.session_id, "user", payload.input.instruction)
        if created:
            _schedule_session_title_generation(
                session,
                payload.input.instruction,
                payload.title_generation_model_id,
            )
        prompt = build_chat_prompt(payload, session)

        yield _to_sse_event("session", {"session_id": session.session_id})
        try:
            parser = _TaggedStreamParser()
            delta_queue: asyncio.Queue[str | None] = asyncio.Queue()

            async def on_delta(delta: str) -> None:
                await delta_queue.put(delta)

            stream_task = asyncio.create_task(
                runtime.run_turn_stream(prompt, session.session_id, on_delta)
            )

            while True:
                if stream_task.done() and delta_queue.empty():
                    break
                try:
                    delta = await asyncio.wait_for(delta_queue.get(), timeout=0.2)
                except asyncio.TimeoutError:
                    continue
                if delta is None:
                    continue
                for event_type, text in parser.feed(delta):
                    yield _to_sse_event(event_type, {"text": text})

            raw_output = await stream_task
            for event_type, text in parser.flush():
                yield _to_sse_event(event_type, {"text": text})

            thinking, answer = _split_output(raw_output)

            session_store.append_turn(
                session.session_id,
                "assistant",
                f"<thinking>{thinking}</thinking>\n<answer>{answer}</answer>",
            )
            yield _to_sse_event("done", {"ok": True, "answer": answer, "thinking": thinking})
        except FileNotFoundError as error:
            yield _to_sse_event(
                "error",
                {"code": "CONFIG_ERROR", "message": str(error), "retryable": False},
            )
            logger.exception("[stream] event=error CONFIG_ERROR")
        except Exception as error:
            yield _to_sse_event(
                "error",
                {"code": "MODEL_ERROR", "message": str(error), "retryable": True},
            )
            logger.exception("[stream] event=error MODEL_ERROR")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/responses")
async def create_response(payload: ResponsesRequest):
    session_id = _resolve_session_id_for_responses(payload)
    session, created = session_store.get_or_create(session_id)
    input_text = _extract_responses_input_text(payload.input).strip()
    session_store.append_turn(session.session_id, "user", input_text)
    if created:
        _schedule_session_title_generation(
            session,
            input_text,
            payload.title_generation_model_id,
        )
    prompt = build_responses_prompt(input_text, session)

    if payload.stream:
        async def event_generator():
            response_id = f"resp_{uuid4().hex}"
            responses_session_index[response_id] = session.session_id

            metadata = dict(payload.metadata or {})
            metadata["session_id"] = session.session_id
            created_obj = _build_responses_completed_object(
                response_id=response_id,
                model=payload.model,
                answer="",
                metadata=metadata,
            )
            yield _to_sse_event(
                "response.created",
                {"type": "response.created", "response": created_obj},
            )

            try:
                parser = _TaggedStreamParser()
                delta_queue: asyncio.Queue[str | None] = asyncio.Queue()

                async def on_delta(delta: str) -> None:
                    await delta_queue.put(delta)

                stream_task = asyncio.create_task(
                    runtime.run_turn_stream(prompt, session.session_id, on_delta)
                )

                answer_buffer = ""
                while True:
                    if stream_task.done() and delta_queue.empty():
                        break
                    try:
                        delta = await asyncio.wait_for(delta_queue.get(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue
                    if delta is None:
                        continue
                    for event_type, text in parser.feed(delta):
                        if event_type != "answer_delta" or not text:
                            continue
                        answer_buffer += text
                        yield _to_sse_event(
                            "response.output_text.delta",
                            {
                                "type": "response.output_text.delta",
                                "response_id": response_id,
                                "delta": text,
                            },
                        )

                raw_output = await stream_task
                for event_type, text in parser.flush():
                    if event_type != "answer_delta" or not text:
                        continue
                    answer_buffer += text
                    yield _to_sse_event(
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "response_id": response_id,
                            "delta": text,
                        },
                    )

                thinking, answer = _split_output(raw_output)
                final_answer = answer.strip() or answer_buffer.strip()
                session_store.append_turn(
                    session.session_id,
                    "assistant",
                    f"<thinking>{thinking}</thinking>\n<answer>{final_answer}</answer>",
                )

                yield _to_sse_event(
                    "response.output_text.done",
                    {
                        "type": "response.output_text.done",
                        "response_id": response_id,
                        "text": final_answer,
                    },
                )
                completed_obj = _build_responses_completed_object(
                    response_id=response_id,
                    model=payload.model,
                    answer=final_answer,
                    metadata=metadata,
                )
                yield _to_sse_event(
                    "response.completed",
                    {"type": "response.completed", "response": completed_obj},
                )
            except FileNotFoundError as error:
                yield _to_sse_event(
                    "response.error",
                    {
                        "type": "response.error",
                        "error": {
                            "code": "CONFIG_ERROR",
                            "message": str(error),
                        },
                    },
                )
            except Exception as error:
                yield _to_sse_event(
                    "response.error",
                    {
                        "type": "response.error",
                        "error": {
                            "code": "MODEL_ERROR",
                            "message": str(error),
                        },
                    },
                )

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        raw_output = await runtime.run_turn(prompt, session.session_id)
        thinking, answer = _split_output(raw_output)
        session_store.append_turn(
            session.session_id,
            "assistant",
            f"<thinking>{thinking}</thinking>\n<answer>{answer}</answer>",
        )
        response_id = f"resp_{uuid4().hex}"
        responses_session_index[response_id] = session.session_id
        metadata = dict(payload.metadata or {})
        metadata["session_id"] = session.session_id
        return _build_responses_completed_object(
            response_id=response_id,
            model=payload.model,
            answer=answer,
            metadata=metadata,
        )
    except FileNotFoundError as error:
        return {
            "error": {
                "code": "CONFIG_ERROR",
                "message": str(error),
            }
        }
    except Exception as error:
        return {
            "error": {
                "code": "MODEL_ERROR",
                "message": str(error),
            }
        }


@app.post("/api/v1/provider-config")
def update_provider_config(
    payload: ProviderConfigRequest,
) -> ProviderConfigSuccessResponse | ProviderConfigErrorResponse:
    try:
        result = apply_provider_config(project_root, payload)
        return ProviderConfigSuccessResponse(result=result)
    except ValueError as error:
        return ProviderConfigErrorResponse(
            error=ErrorDetail(
                code="INVALID_REQUEST",
                message=str(error),
                retryable=False,
            )
        )
    except Exception as error:
        return ProviderConfigErrorResponse(
            error=ErrorDetail(
                code="INTERNAL",
                message=str(error),
                retryable=False,
            )
        )


# --- Model-Provider List API Endpoints ---

@app.get("/api/v1/model-providers")
def get_model_providers() -> ModelProviderListResponse:
    """获取所有 model-provider 配置"""
    return list_model_providers(project_root)


@app.post("/api/v1/model-providers")
def create_or_update_model_provider(
    payload: ModelProviderSaveRequest,
) -> ModelProviderSaveResponse:
    """创建或更新一个 model-provider 配置"""
    return save_model_provider(project_root, payload)


@app.delete("/api/v1/model-providers")
def remove_model_provider(
    payload: ModelProviderDeleteRequest,
) -> ModelProviderDeleteResponse:
    """删除一个 model-provider 配置"""
    return delete_model_provider(project_root, payload)


@app.get("/api/v1/sessions")
def list_sessions(limit: int = 100) -> SessionListResponse:
    """列出 nanobot workspace 中可复用的会话。"""
    response = list_nanobot_sessions(project_root, settings, limit=limit)
    return _apply_in_memory_titles(response)
