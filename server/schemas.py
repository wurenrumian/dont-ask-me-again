from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ClientInfo(BaseModel):
    name: str
    version: str


class InvokeInput(BaseModel):
    active_file_path: str
    active_file_content: str
    selection_text: str
    instruction: str


class InvokeRequest(BaseModel):
    request_id: str
    session_id: str | None = None
    input: InvokeInput
    client: ClientInfo


class InvokeResult(BaseModel):
    session_id: str
    filename: str = Field(min_length=1)
    markdown: str


class ErrorDetail(BaseModel):
    code: Literal[
        "INVALID_REQUEST",
        "INVALID_AGENT_OUTPUT",
        "MODEL_ERROR",
        "INTERNAL",
    ]
    message: str
    retryable: bool


class InvokeSuccessResponse(BaseModel):
    ok: Literal[True] = True
    result: InvokeResult
    error: None = None


class InvokeErrorResponse(BaseModel):
    ok: Literal[False] = False
    result: None = None
    error: ErrorDetail
