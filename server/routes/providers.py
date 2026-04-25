from __future__ import annotations

from fastapi import APIRouter

from server.context import ServerContext
from server.provider_config_store import (
    apply_provider_config,
    delete_model_provider,
    list_model_providers,
    save_model_provider,
)
from server.schemas import (
    ErrorDetail,
    ModelProviderDeleteRequest,
    ModelProviderDeleteResponse,
    ModelProviderListResponse,
    ModelProviderSaveRequest,
    ModelProviderSaveResponse,
    ProviderConfigErrorResponse,
    ProviderConfigRequest,
    ProviderConfigSuccessResponse,
)


def create_router(ctx: ServerContext) -> APIRouter:
    router = APIRouter()

    @router.post("/api/v1/provider-config")
    def update_provider_config(
        payload: ProviderConfigRequest,
    ) -> ProviderConfigSuccessResponse | ProviderConfigErrorResponse:
        try:
            result = apply_provider_config(ctx.project_root, payload)
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
