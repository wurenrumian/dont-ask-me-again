import asyncio
import sys
from types import SimpleNamespace

import pytest

from server.schemas import ImageGenerationOptions, ModelProviderEntry
from server.services.image_generation import (
    GeminiImageAdapter,
    ImageGenerationTool,
    OpenAICompatImageAdapter,
    OpenAIImageAdapter,
    UnsupportedImageAdapter,
    build_image_request_options,
    resolve_image_adapter,
)


def _entry(provider: str, model: str = "image-model") -> ModelProviderEntry:
    return ModelProviderEntry(
        id=f"{provider}-1",
        provider=provider,
        model=model,
        api_base=None,
        is_default=False,
        label=None,
    )


def test_image_generation_tool_refuses_when_request_limit_is_reached() -> None:
    emitted: list[dict[str, str]] = []

    async def fake_generate(prompt: str, filename: str) -> dict[str, str]:
        return {
            "filename": filename,
            "mime_type": "image/png",
            "base64": "aGVsbG8=",
        }

    async def fake_emit(payload: dict[str, str]) -> None:
        emitted.append(payload)

    tool = ImageGenerationTool(
        options=ImageGenerationOptions(
            enabled=True,
            model_id="image-model-1",
            max_images=1,
        ),
        generate_image=fake_generate,
        emit_image=fake_emit,
    )

    first = asyncio.run(tool.execute(prompt="cover prompt", filename="cover"))
    second = asyncio.run(tool.execute(prompt="second prompt", filename="second"))

    assert "![[cover.png]]" in first
    assert "maximum image generation limit" in second
    assert emitted == [
        {
            "filename": "cover",
            "mime_type": "image/png",
            "base64": "aGVsbG8=",
        }
    ]


def test_resolve_image_adapter_selects_provider_specific_implementations() -> None:
    assert isinstance(resolve_image_adapter(_entry("openai")), OpenAIImageAdapter)
    assert isinstance(resolve_image_adapter(_entry("gemini")), GeminiImageAdapter)
    assert isinstance(resolve_image_adapter(_entry("custom")), OpenAICompatImageAdapter)
    assert isinstance(resolve_image_adapter(_entry("openrouter")), OpenAICompatImageAdapter)
    assert isinstance(resolve_image_adapter(_entry("anthropic")), UnsupportedImageAdapter)


def test_openai_adapter_uses_openai_sdk(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class FakeImages:
        async def generate(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json="b3BlbmFp")])

    class FakeAsyncOpenAI:
        def __init__(self, **kwargs):
            calls.append({"client": kwargs})
            self.images = FakeImages()

    fake_openai = SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI)
    monkeypatch.setitem(sys.modules, "openai", fake_openai)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    result = asyncio.run(
        OpenAIImageAdapter().generate(
            _entry("openai", "gpt-image-1"),
            prompt="draw a cover",
            filename="cover",
            api_key="sk-test",
        )
    )

    assert result == {"filename": "cover", "mime_type": "image/png", "base64": "b3BlbmFp"}
    assert calls[0]["client"] == {"api_key": "sk-test"}
    assert calls[1]["model"] == "gpt-image-1"
    assert calls[1]["prompt"] == "draw a cover"
    assert calls[1]["n"] == 1


def test_gemini_adapter_uses_google_genai_sdk_for_imagen(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class FakeModels:
        def generate_images(self, **kwargs):
            calls.append(kwargs)
            image = SimpleNamespace(image_bytes=b"gemini-bytes")
            return SimpleNamespace(generated_images=[SimpleNamespace(image=image)])

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append({"client": kwargs})
            self.models = FakeModels()

    fake_genai = SimpleNamespace(Client=FakeClient)
    fake_types = SimpleNamespace(
        GenerateImagesConfig=lambda **kwargs: {"config": kwargs}
    )
    monkeypatch.setitem(sys.modules, "google", SimpleNamespace(genai=fake_genai))
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_types)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")

    result = asyncio.run(
        GeminiImageAdapter().generate(
            _entry("gemini", "imagen-4.0-generate-001"),
            prompt="draw a cover",
            filename="cover",
            api_key="gemini-key",
        )
    )

    assert result == {
        "filename": "cover",
        "mime_type": "image/png",
        "base64": "Z2VtaW5pLWJ5dGVz",
    }
    assert calls[0]["client"] == {"api_key": "gemini-key"}
    assert calls[1]["model"] == "imagen-4.0-generate-001"
    assert calls[1]["prompt"] == "draw a cover"


def test_unsupported_adapter_reports_provider_name() -> None:
    with pytest.raises(ValueError, match="does not support image generation"):
        asyncio.run(
            UnsupportedImageAdapter().generate(
                _entry("anthropic"),
                prompt="draw",
                filename="cover",
            )
        )


def test_build_image_request_options_includes_packy_parameters() -> None:
    options = ImageGenerationOptions(
        enabled=True,
        model_id="image-model-1",
        max_images=1,
        size="3840x2160",
        quality="high",
        output_format="png",
    )

    assert build_image_request_options(options) == {
        "n": 1,
        "response_format": "b64_json",
        "size": "3840x2160",
        "quality": "high",
        "output_format": "png",
    }
