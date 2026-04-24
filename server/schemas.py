from __future__ import annotations

from typing import Literal
from typing import Any

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
    thinking: str
    answer: str


class ErrorDetail(BaseModel):
    code: Literal[
        "INVALID_REQUEST",
        "CONFIG_ERROR",
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


ProviderName = Literal[
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "minimax",
    "custom",
    "azure_openai",
    "ollama",
]


class ProviderConfigRequest(BaseModel):
    provider: ProviderName
    model: str = Field(min_length=1)
    api_base: str | None = None
    api_key: str | None = None


class ProviderConfigResult(BaseModel):
    provider: ProviderName
    model: str
    api_base: str | None = None
    api_key_env: str | None = None
    has_api_key: bool


class ProviderConfigSuccessResponse(BaseModel):
    ok: Literal[True] = True
    result: ProviderConfigResult
    error: None = None


class ProviderConfigErrorResponse(BaseModel):
    ok: Literal[False] = False
    result: None = None
    error: ErrorDetail


# --- Model-Provider Configuration Schemas ---

class ModelProviderEntry(BaseModel):
    """单个 model 与 provider 的配置项"""
    id: str = Field(min_length=1, description="唯一标识符")
    provider: ProviderName
    model: str = Field(min_length=1)
    api_base: str | None = None
    api_key_env: str | None = None  # 环境变量名，不直接存储 key
    is_default: bool = Field(default=False)
    label: str | None = Field(default=None, description="可选的展示名称")


class ModelProviderListRequest(BaseModel):
    """获取 model-provider 列表的请求"""
    pass


class ModelProviderListResponse(BaseModel):
    """model-provider 列表响应"""
    ok: Literal[True] = True
    entries: list[ModelProviderEntry]
    default_id: str | None = None


class ModelProviderSaveRequest(BaseModel):
    """保存 model-provider 配置的请求（单个）"""
    id: str | None = None  # None 表示新建
    provider: ProviderName
    model: str = Field(min_length=1)
    api_base: str | None = None
    api_key: str | None = None
    is_default: bool = False
    label: str | None = None


class ModelProviderSaveResponse(BaseModel):
    """保存结果响应"""
    ok: Literal[True] = True
    entry: ModelProviderEntry
    api_key_env: str | None = None  # 返回环境变量名
    api_key_stored: bool = False


class ModelProviderDeleteRequest(BaseModel):
    """删除 model-provider 配置的请求"""
    id: str = Field(min_length=1)


class ModelProviderDeleteResponse(BaseModel):
    """删除结果响应"""
    ok: Literal[True] = True


class SessionEntry(BaseModel):
    session_id: str
    updated_at: str | None = None


class SessionListResponse(BaseModel):
    ok: Literal[True] = True
    entries: list[SessionEntry]


class ResponsesRequest(BaseModel):
    model: str | None = None
    input: str | list[Any] | dict[str, Any] | None = None
    stream: bool = False
    previous_response_id: str | None = None
    metadata: dict[str, Any] | None = None
    session_id: str | None = None
