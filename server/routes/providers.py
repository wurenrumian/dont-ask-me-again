from __future__ import annotations

from fastapi import APIRouter

from server.context import ServerContext
from server.provider_config_store import (
    delete_model_provider,
    list_model_providers,
    save_model_provider,
)
from server.schemas import (
    ModelProviderDeleteRequest,
    ModelProviderDeleteResponse,
    ModelProviderListResponse,
    ModelProviderSaveRequest,
    ModelProviderSaveResponse,
)


def create_router(ctx: ServerContext) -> APIRouter:
    router = APIRouter()

    @router.get("/api/v1/model-providers")
    def get_model_providers() -> ModelProviderListResponse:
        return list_model_providers(ctx.project_root)

    @router.post("/api/v1/model-providers")
    def create_or_update_model_provider(
        payload: ModelProviderSaveRequest,
    ) -> ModelProviderSaveResponse:
        return save_model_provider(ctx.project_root, payload)

    @router.delete("/api/v1/model-providers")
    def remove_model_provider(
        payload: ModelProviderDeleteRequest,
    ) -> ModelProviderDeleteResponse:
        return delete_model_provider(ctx.project_root, payload)

    return router
