from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI

from server.config import ServerSettings
from server.prompt_builder import build_runtime_prompt
from server.runtime.nanobot_adapter import NanobotAdapter
from server.result_normalizer import normalize_runtime_result
from server.schemas import (
    ErrorDetail,
    InvokeErrorResponse,
    InvokeRequest,
    InvokeSuccessResponse,
)
from server.session_store import InMemorySessionStore

app = FastAPI(title="dont-ask-me-again-server", version="0.1.0")

project_root = Path(__file__).resolve().parent.parent
settings = ServerSettings()
session_store = InMemorySessionStore()
runtime = NanobotAdapter(project_root=project_root, settings=settings)


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/invoke")
async def invoke(payload: InvokeRequest) -> InvokeSuccessResponse | InvokeErrorResponse:
    session = session_store.get_or_create(payload.session_id)
    session_store.append_turn(session.session_id, "user", payload.input.instruction)
    prompt = build_runtime_prompt(payload, session)

    try:
        raw_output = await runtime.run_turn(prompt, session.session_id)
        result = normalize_runtime_result(raw_output, session.session_id)
        session_store.append_turn(session.session_id, "assistant", result.markdown)
        return InvokeSuccessResponse(result=result)
    except FileNotFoundError as error:
        return InvokeErrorResponse(
            error=ErrorDetail(
                code="INTERNAL",
                message=str(error),
                retryable=False,
            )
        )
    except (KeyError, ValueError, json.JSONDecodeError) as error:
        return InvokeErrorResponse(
            error=ErrorDetail(
                code="INVALID_AGENT_OUTPUT",
                message=str(error),
                retryable=True,
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
