from __future__ import annotations

import sys
import base64
import importlib
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol

import httpx
from loguru import logger

from server.provider_config_store import get_model_provider_by_id
from server.provider_secret_store import get_provider_api_key
from server.schemas import ImageGenerationOptions, ModelProviderEntry

vendor_root = Path(__file__).resolve().parents[2] / "vendor" / "nanobot"
vendor_path = str(vendor_root.resolve())
if vendor_path not in sys.path:
    sys.path.insert(0, vendor_path)

from nanobot.agent.tools.base import Tool, tool_parameters  # noqa: E402
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema  # noqa: E402


ImagePayload = dict[str, str]
GenerateImageCallable = Callable[[str, str], Awaitable[ImagePayload]]
EmitImageCallable = Callable[[ImagePayload], Awaitable[None]]


class ImageAdapter(Protocol):
    async def generate(
        self,
        entry: ModelProviderEntry,
        *,
        prompt: str,
        filename: str,
        api_key: str | None = None,
    ) -> ImagePayload:
        ...


def _strip_known_image_extension(filename: str) -> str:
    lowered = filename.lower()
    for extension in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        if lowered.endswith(extension):
            return filename[: -len(extension)]
    return filename


def _extension_from_mime_type(mime_type: str) -> str:
    normalized = mime_type.lower().split(";", 1)[0]
    if normalized in {"image/jpeg", "image/jpg"}:
        return "jpg"
    if normalized == "image/webp":
        return "webp"
    if normalized == "image/gif":
        return "gif"
    return "png"


def build_markdown_image_link(filename: str, mime_type: str = "image/png") -> str:
    stem = _strip_known_image_extension(filename.strip()) or "generated-image"
    return f"![[{stem}.{_extension_from_mime_type(mime_type)}]]"


@tool_parameters(
    tool_parameters_schema(
        prompt=StringSchema(description="Prompt for the image generation model.", min_length=1),
        filename=StringSchema(
            description="Short filename without path or extension. The final answer should reference ![[filename.png]].",
            min_length=1,
            max_length=120,
        ),
    )
)
class ImageGenerationTool(Tool):
    def __init__(
        self,
        *,
        options: ImageGenerationOptions,
        generate_image: GenerateImageCallable,
        emit_image: EmitImageCallable,
    ) -> None:
        self.options = options
        self._generate_image = generate_image
        self._emit_image = emit_image
        self._generated_count = 0

    @property
    def name(self) -> str:
        return "generate_image"

    @property
    def description(self) -> str:
        return (
            "Generate one image for the active Obsidian note. "
            "Provide a prompt and a short filename without path or extension."
        )

    @property
    def exclusive(self) -> bool:
        return True

    async def execute(self, **kwargs: Any) -> str:
        if not self.options.enabled:
            logger.warning("[image] generate_image refused: permission disabled")
            return "Error: image generation is not enabled for this request."
        if not self.options.model_id:
            logger.warning("[image] generate_image refused: no image model configured")
            return "Error: no image generation model is configured."
        if self._generated_count >= self.options.max_images:
            logger.warning(
                "[image] generate_image refused: max_images reached ({})",
                self.options.max_images,
            )
            return "Error: maximum image generation limit reached for this request."

        prompt = str(kwargs.get("prompt") or "").strip()
        filename = str(kwargs.get("filename") or "").strip()
        if not prompt:
            logger.warning("[image] generate_image refused: empty prompt")
            return "Error: prompt is required."
        if not filename:
            logger.warning("[image] generate_image refused: empty filename")
            return "Error: filename is required."

        logger.info(
            "[image] generate_image start model_id={} filename={} count={}/{}",
            self.options.model_id,
            filename,
            self._generated_count + 1,
            self.options.max_images,
        )
        payload = await self._generate_image(prompt, filename)
        self._generated_count += 1
        await self._emit_image(payload)
        markdown_link = build_markdown_image_link(
            payload.get("filename", filename),
            payload.get("mime_type", "image/png"),
        )
        logger.info(
            "[image] generate_image success filename={} mime_type={}",
            payload.get("filename", filename),
            payload.get("mime_type", "image/png"),
        )
        return f"Generated image. Reference it in the final answer as {markdown_link}"


def _api_base_for_entry(entry: ModelProviderEntry) -> str:
    if entry.api_base:
        return entry.api_base.rstrip("/")
    provider_kind = entry.provider_kind or entry.provider
    if provider_kind == "openai":
        return "https://api.openai.com/v1"
    if provider_kind == "ollama":
        return "http://127.0.0.1:11434/v1"
    raise ValueError(f"Image generation model '{entry.id}' requires API Base URL.")


def _extract_image_payload(data: dict[str, Any], filename: str) -> ImagePayload:
    images = data.get("data")
    if not isinstance(images, list) or not images:
        raise ValueError("Image generation response did not include data.")
    first = images[0]
    if not isinstance(first, dict):
        raise ValueError("Image generation response item was invalid.")
    b64_json = first.get("b64_json")
    if isinstance(b64_json, str) and b64_json:
        return {"filename": filename, "mime_type": "image/png", "base64": b64_json}
    raise ValueError("Image generation response did not include base64 image data.")


def build_image_request_options(options: ImageGenerationOptions) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "n": 1,
        "response_format": "b64_json",
    }
    if options.size:
        payload["size"] = options.size
    if options.quality:
        payload["quality"] = options.quality
    if options.output_format:
        payload["output_format"] = options.output_format
    return payload


def _extract_openai_b64_image(response: Any) -> str:
    data = getattr(response, "data", None)
    if isinstance(data, list) and data:
        first = data[0]
        b64_json = getattr(first, "b64_json", None)
        if isinstance(b64_json, str) and b64_json:
            return b64_json
    raise ValueError("OpenAI image response did not include b64_json.")


def _coerce_bytes_to_base64(value: Any) -> str | None:
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, str) and value:
        return value
    return None


def _extract_gemini_generated_image(response: Any) -> str:
    generated_images = getattr(response, "generated_images", None)
    if isinstance(generated_images, list) and generated_images:
        image = getattr(generated_images[0], "image", None)
        if image is not None:
            for attr in ("image_bytes", "data"):
                encoded = _coerce_bytes_to_base64(getattr(image, attr, None))
                if encoded:
                    return encoded
    raise ValueError("Gemini image response did not include image bytes.")


class OpenAIImageAdapter:
    def __init__(self, options: ImageGenerationOptions | None = None) -> None:
        self.options = options or ImageGenerationOptions(enabled=True)

    async def generate(
        self,
        entry: ModelProviderEntry,
        *,
        prompt: str,
        filename: str,
        api_key: str | None = None,
    ) -> ImagePayload:
        from openai import AsyncOpenAI

        client_options: dict[str, str] = {}
        if api_key:
            client_options["api_key"] = api_key
        if entry.api_base:
            client_options["base_url"] = entry.api_base.rstrip("/")

        client = AsyncOpenAI(**client_options)
        response = await client.images.generate(
            model=entry.model,
            prompt=prompt,
            **build_image_request_options(self.options),
        )
        return {
            "filename": filename,
            "mime_type": "image/png",
            "base64": _extract_openai_b64_image(response),
        }


class GeminiImageAdapter:
    def __init__(self, options: ImageGenerationOptions | None = None) -> None:
        self.options = options or ImageGenerationOptions(enabled=True)

    async def generate(
        self,
        entry: ModelProviderEntry,
        *,
        prompt: str,
        filename: str,
        api_key: str | None = None,
    ) -> ImagePayload:
        from google import genai

        types = importlib.import_module("google.genai.types")

        client_options: dict[str, str] = {}
        if api_key:
            client_options["api_key"] = api_key
        client = genai.Client(**client_options)
        response = client.models.generate_images(
            model=entry.model,
            prompt=prompt,
            config=types.GenerateImagesConfig(number_of_images=1),
        )
        return {
            "filename": filename,
            "mime_type": "image/png",
            "base64": _extract_gemini_generated_image(response),
        }


class OpenAICompatImageAdapter:
    def __init__(self, options: ImageGenerationOptions | None = None) -> None:
        self.options = options or ImageGenerationOptions(enabled=True)

    async def generate(
        self,
        entry: ModelProviderEntry,
        *,
        prompt: str,
        filename: str,
        api_key: str | None = None,
    ) -> ImagePayload:
        api_base = _api_base_for_entry(entry)
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        request_body = {
            "model": entry.model,
            "prompt": prompt,
            **build_image_request_options(self.options),
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{api_base}/images/generations",
                headers=headers,
                json=request_body,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                safe_body = {**request_body, "prompt": "<omitted>"}
                logger.error(
                    "[image] OpenAI-compatible image request failed status={} body={} request={}",
                    response.status_code,
                    response.text[:4000],
                    safe_body,
                )
                raise
            payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Image generation response was invalid.")
        return _extract_image_payload(payload, filename)


class UnsupportedImageAdapter:
    def __init__(self, options: ImageGenerationOptions | None = None) -> None:
        self.options = options or ImageGenerationOptions(enabled=True)

    async def generate(
        self,
        entry: ModelProviderEntry,
        *,
        prompt: str,
        filename: str,
        api_key: str | None = None,
    ) -> ImagePayload:
        raise ValueError(f"Provider '{entry.provider}' does not support image generation.")


def resolve_image_adapter(
    entry: ModelProviderEntry,
    options: ImageGenerationOptions | None = None,
) -> ImageAdapter:
    provider_kind = entry.provider_kind or entry.provider
    if provider_kind == "openai":
        return OpenAIImageAdapter(options)
    if provider_kind == "gemini":
        return GeminiImageAdapter(options)
    if provider_kind in {
        "openai_compatible",
        "openrouter",
        "custom",
        "azure_openai",
        "minimax",
        "deepseek",
        "ollama",
    }:
        return OpenAICompatImageAdapter(options)
    return UnsupportedImageAdapter(options)


async def generate_image_with_model(
    *,
    project_root: Path,
    model_id: str,
    prompt: str,
    filename: str,
    options: ImageGenerationOptions | None = None,
) -> ImagePayload:
    entry = get_model_provider_by_id(project_root, model_id)
    if entry is None:
        logger.error("[image] configured image model not found: {}", model_id)
        raise ValueError(f"Image generation model '{model_id}' is not configured.")

    logger.info(
        "[image] resolved adapter provider={} kind={} model={} id={}",
        entry.provider_name or entry.provider,
        entry.provider_kind or entry.provider,
        entry.model,
        entry.id,
    )
    return await resolve_image_adapter(entry, options).generate(
        entry,
        prompt=prompt,
        filename=filename,
        api_key=get_provider_api_key(project_root, entry.provider_id),
    )
