from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from server.context import ServerContext
from server.prompt_builder import build_chat_prompt, build_responses_prompt
from server.provider_config_store import ensure_runtime_config_synced
from server.schemas import (
    ErrorDetail,
    InvokeErrorResponse,
    InvokeRequest,
    InvokeSuccessResponse,
    ResponsesRequest,
)
from server.services.title_generator import schedule_session_title_generation
from server.stream_parser import TaggedStreamParser

_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL | re.IGNORECASE)
_ANSWER_RE = re.compile(r"<answer>(.*?)</answer>", re.DOTALL | re.IGNORECASE)


def to_sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def split_output(raw_output: str) -> tuple[str, str]:
    thinking_match = _THINKING_RE.search(raw_output)
    answer_match = _ANSWER_RE.search(raw_output)

    thinking = thinking_match.group(1).strip() if thinking_match else ""
    answer = answer_match.group(1).strip() if answer_match else raw_output.strip()
    return thinking, answer


def extract_responses_input_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [extract_responses_input_text(item) for item in value]
        return "\n".join(part.strip() for part in parts if part and part.strip())
    if isinstance(value, dict):
        if "content" in value:
            role = str(value.get("role", "")).strip()
            content_text = extract_responses_input_text(value.get("content"))
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

        parts = [extract_responses_input_text(entry) for entry in value.values()]
        return "\n".join(part.strip() for part in parts if part and part.strip())
    return str(value)


def resolve_session_id_for_responses(ctx: ServerContext, payload: ResponsesRequest) -> str | None:
    metadata_session = None
    if isinstance(payload.metadata, dict):
        raw = payload.metadata.get("session_id")
        if isinstance(raw, str) and raw.strip():
            metadata_session = raw.strip()

    previous_session = None
    if payload.previous_response_id:
        previous_session = ctx.responses_session_index.get(payload.previous_response_id)

    return payload.session_id or metadata_session or previous_session


def build_responses_completed_object(
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


def create_router(ctx: ServerContext) -> APIRouter:
    router = APIRouter()

    @router.post("/api/v1/invoke")
    async def invoke(payload: InvokeRequest) -> InvokeSuccessResponse | InvokeErrorResponse:
        ensure_runtime_config_synced(ctx.project_root)
        session, created = ctx.session_store.get_or_create(payload.session_id)
        ctx.session_store.append_turn(session.session_id, "user", payload.input.instruction)
        if created:
            schedule_session_title_generation(
                ctx,
                session,
                payload.input.instruction,
                payload.title_generation_model_id,
            )
        prompt = build_chat_prompt(payload, session)

        try:
            if payload.image_generation and payload.image_generation.enabled:
                raw_output = await ctx.runtime.run_turn(
                    prompt,
                    session.session_id,
                    image_generation=payload.image_generation,
                )
            else:
                raw_output = await ctx.runtime.run_turn(prompt, session.session_id)
            thinking, answer = split_output(raw_output)
            result = {
                "session_id": session.session_id,
                "thinking": thinking,
                "answer": answer,
            }
            ctx.session_store.append_turn(
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

    @router.post("/api/v1/chat/stream")
    async def stream_chat(payload: InvokeRequest) -> StreamingResponse:
        async def event_generator():
            ensure_runtime_config_synced(ctx.project_root)
            session, created = ctx.session_store.get_or_create(payload.session_id)
            ctx.session_store.append_turn(session.session_id, "user", payload.input.instruction)
            if created:
                schedule_session_title_generation(
                    ctx,
                    session,
                    payload.input.instruction,
                    payload.title_generation_model_id,
                )
            prompt = build_chat_prompt(payload, session)

            yield to_sse_event("session", {"session_id": session.session_id})
            try:
                parser = TaggedStreamParser()
                delta_queue: asyncio.Queue[str | None] = asyncio.Queue()
                image_queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()

                async def on_delta(delta: str) -> None:
                    await delta_queue.put(delta)

                async def on_image(image_payload: dict[str, str]) -> None:
                    await image_queue.put(image_payload)

                if payload.image_generation and payload.image_generation.enabled:
                    stream_task = asyncio.create_task(
                        ctx.runtime.run_turn_stream(
                            prompt,
                            session.session_id,
                            on_delta,
                            image_generation=payload.image_generation,
                            on_image=on_image,
                        )
                    )
                else:
                    stream_task = asyncio.create_task(
                        ctx.runtime.run_turn_stream(prompt, session.session_id, on_delta)
                    )

                while True:
                    while not image_queue.empty():
                        yield to_sse_event("image_generated", await image_queue.get())
                    if stream_task.done() and delta_queue.empty() and image_queue.empty():
                        break
                    try:
                        delta = await asyncio.wait_for(delta_queue.get(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue
                    if delta is None:
                        continue
                    for event_type, text in parser.feed(delta):
                        yield to_sse_event(event_type, {"text": text})

                raw_output = await stream_task
                while not image_queue.empty():
                    yield to_sse_event("image_generated", await image_queue.get())
                for event_type, text in parser.flush():
                    yield to_sse_event(event_type, {"text": text})

                thinking, answer = split_output(raw_output)

                ctx.session_store.append_turn(
                    session.session_id,
                    "assistant",
                    f"<thinking>{thinking}</thinking>\n<answer>{answer}</answer>",
                )
                yield to_sse_event("done", {"ok": True, "answer": answer, "thinking": thinking})
            except FileNotFoundError as error:
                yield to_sse_event(
                    "error",
                    {"code": "CONFIG_ERROR", "message": str(error), "retryable": False},
                )
                ctx.logger.exception("[stream] event=error CONFIG_ERROR")
            except Exception as error:
                yield to_sse_event(
                    "error",
                    {"code": "MODEL_ERROR", "message": str(error), "retryable": True},
                )
                ctx.logger.exception("[stream] event=error MODEL_ERROR")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/v1/responses")
    async def create_response(payload: ResponsesRequest):
        session_id = resolve_session_id_for_responses(ctx, payload)
        session, created = ctx.session_store.get_or_create(session_id)
        input_text = extract_responses_input_text(payload.input).strip()
        ctx.session_store.append_turn(session.session_id, "user", input_text)
        if created:
            schedule_session_title_generation(
                ctx,
                session,
                input_text,
                payload.title_generation_model_id,
            )
        prompt = build_responses_prompt(input_text, session, payload.image_generation)

        if payload.stream:
            async def event_generator():
                response_id = f"resp_{uuid4().hex}"
                ctx.responses_session_index[response_id] = session.session_id

                metadata = dict(payload.metadata or {})
                metadata["session_id"] = session.session_id
                created_obj = build_responses_completed_object(
                    response_id=response_id,
                    model=payload.model,
                    answer="",
                    metadata=metadata,
                )
                yield to_sse_event(
                    "response.created",
                    {"type": "response.created", "response": created_obj},
                )

                try:
                    parser = TaggedStreamParser()
                    delta_queue: asyncio.Queue[str | None] = asyncio.Queue()

                    async def on_delta(delta: str) -> None:
                        await delta_queue.put(delta)

                    image_queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()

                    async def on_image(image_payload: dict[str, str]) -> None:
                        await image_queue.put(image_payload)

                    if payload.image_generation and payload.image_generation.enabled:
                        stream_task = asyncio.create_task(
                            ctx.runtime.run_turn_stream(
                                prompt,
                                session.session_id,
                                on_delta,
                                image_generation=payload.image_generation,
                                on_image=on_image,
                            )
                        )
                    else:
                        stream_task = asyncio.create_task(
                            ctx.runtime.run_turn_stream(prompt, session.session_id, on_delta)
                        )

                    answer_buffer = ""
                    while True:
                        while not image_queue.empty():
                            yield to_sse_event("image_generated", await image_queue.get())
                        if stream_task.done() and delta_queue.empty() and image_queue.empty():
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
                            yield to_sse_event(
                                "response.output_text.delta",
                                {
                                    "type": "response.output_text.delta",
                                    "response_id": response_id,
                                    "delta": text,
                                },
                            )

                    raw_output = await stream_task
                    while not image_queue.empty():
                        yield to_sse_event("image_generated", await image_queue.get())
                    for event_type, text in parser.flush():
                        if event_type != "answer_delta" or not text:
                            continue
                        answer_buffer += text
                        yield to_sse_event(
                            "response.output_text.delta",
                            {
                                "type": "response.output_text.delta",
                                "response_id": response_id,
                                "delta": text,
                            },
                        )

                    thinking, answer = split_output(raw_output)
                    final_answer = answer.strip() or answer_buffer.strip()
                    ctx.session_store.append_turn(
                        session.session_id,
                        "assistant",
                        f"<thinking>{thinking}</thinking>\n<answer>{final_answer}</answer>",
                    )

                    yield to_sse_event(
                        "response.output_text.done",
                        {
                            "type": "response.output_text.done",
                            "response_id": response_id,
                            "text": final_answer,
                        },
                    )
                    completed_obj = build_responses_completed_object(
                        response_id=response_id,
                        model=payload.model,
                        answer=final_answer,
                        metadata=metadata,
                    )
                    yield to_sse_event(
                        "response.completed",
                        {"type": "response.completed", "response": completed_obj},
                    )
                except FileNotFoundError as error:
                    yield to_sse_event(
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
                    yield to_sse_event(
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
            if payload.image_generation and payload.image_generation.enabled:
                raw_output = await ctx.runtime.run_turn(
                    prompt,
                    session.session_id,
                    image_generation=payload.image_generation,
                )
            else:
                raw_output = await ctx.runtime.run_turn(prompt, session.session_id)
            thinking, answer = split_output(raw_output)
            ctx.session_store.append_turn(
                session.session_id,
                "assistant",
                f"<thinking>{thinking}</thinking>\n<answer>{answer}</answer>",
            )
            response_id = f"resp_{uuid4().hex}"
            ctx.responses_session_index[response_id] = session.session_id
            metadata = dict(payload.metadata or {})
            metadata["session_id"] = session.session_id
            return build_responses_completed_object(
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

    return router
