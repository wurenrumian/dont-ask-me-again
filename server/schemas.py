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


class ImageGenerationOptions(BaseModel):
    enabled: bool = False
    model_id: str | None = None
    max_images: int = Field(default=3, ge=1, le=20)
    size: str | None = None
    quality: str | None = None
    output_format: str | None = None


class InvokeRequest(BaseModel):
    request_id: str
    session_id: str | None = None
    title_generation_model_id: str | None = None
    image_generation: ImageGenerationOptions | None = None
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
    "openai_compatible",
    "anthropic",
    "gemini",
    "deepseek",
    "minimax",
    "custom",
    "azure_openai",
    "ollama",
]


# --- Model-Provider Configuration Schemas ---

class ModelProviderEntry(BaseModel):
    """Flattened model entry with its owning provider information."""
    id: str = Field(min_length=1, description="唯一标识符")
    provider: ProviderName
    model: str = Field(min_length=1)
    api_base: str | None = None
    has_api_key: bool = False
    is_default: bool = Field(default=False)
    label: str | None = Field(default=None, description="可选的展示名称")
    provider_id: str | None = None
    provider_name: str | None = None
    provider_kind: ProviderName | None = None
    capabilities: list[str] = Field(default_factory=lambda: ["chat", "title"])


class ModelProviderListRequest(BaseModel):
    """获取 model-provider 列表的请求"""
    pass


class ModelProviderListResponse(BaseModel):
    """model-provider 列表响应"""
    ok: Literal[True] = True
    entries: list[ModelProviderEntry]
    default_id: str | None = None


class ModelProviderSaveRequest(BaseModel):
    """Save a model and its owning provider configuration."""
    id: str | None = None  # None 表示新建
    provider: ProviderName
    model: str = Field(min_length=1)
    api_base: str | None = None
    api_key: str | None = None
    is_default: bool = False
    label: str | None = None
    provider_id: str | None = None
    provider_name: str | None = None
    capabilities: list[str] | None = None


class ModelProviderSaveResponse(BaseModel):
    """保存结果响应"""
    ok: Literal[True] = True
    entry: ModelProviderEntry
    api_key_stored: bool = False


class ModelProviderDeleteRequest(BaseModel):
    """删除 model-provider 配置的请求"""
    id: str = Field(min_length=1)


class ModelProviderDeleteResponse(BaseModel):
    """删除结果响应"""
    ok: Literal[True] = True


class SessionEntry(BaseModel):
    session_id: str
    title: str | None = None
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
    title_generation_model_id: str | None = None
    image_generation: ImageGenerationOptions | None = None
