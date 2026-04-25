# Agent Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved one-request agent image generation flow.

**Architecture:** Extend the existing chat request with an optional image generation block. The backend registers a `generate_image` nanobot tool only for permitted requests and streams `image_generated` SSE events. The frontend adds a runtime toggle, persists model/max settings, saves image events into the active note folder, and does not inject links itself.

**Tech Stack:** Obsidian plugin TypeScript, Vitest, FastAPI/Pydantic, httpx, pytest, vendored nanobot tools.

---

### Task 1: Frontend Request, Stream Event, And Image File Helpers

**Files:**
- Modify: `src/api-client.ts`
- Modify: `src/file-actions.ts`
- Test: `tests/api-client.test.ts`
- Test: `tests/api-client-stream.test.ts`
- Test: `tests/file-actions.test.ts`

- [x] Add failing tests for `buildToolRequest` image payload, `image_generated` SSE parsing, and image path helper behavior.
- [x] Implement `imageGenerationRequestSchema`, image stream event mapping, filename sanitization, MIME extension selection, and unique same-folder image path resolution.
- [x] Run targeted frontend tests.

### Task 2: Floating Toggle, Settings, And Saving

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/floating-ui.ts`
- Modify: `src/main.ts`
- Modify: `styles.css`
- Test: `tests/api-client.test.ts`

- [x] Add failing settings default tests.
- [x] Add persistent `imageGenerationModelId` and `maxImagesPerRequest`.
- [x] Add horizontal context row with current-file pill and one-request image toggle.
- [x] Send image generation settings only when the runtime toggle is enabled.
- [x] Save received image events with `app.vault.createBinary` into the active note folder.
- [x] Reset the runtime toggle after request completion or failure.
- [x] Run targeted frontend tests.

### Task 3: Backend Schema, Prompt, Tool, And SSE Event

**Files:**
- Modify: `server/schemas.py`
- Modify: `server/prompt_builder.py`
- Modify: `server/runtime/nanobot_adapter.py`
- Modify: `server/routes/chat.py`
- Create: `server/services/image_generation.py`
- Test: `server/tests/test_app.py`
- Test: `server/tests/test_prompt_builder.py`

- [x] Add failing backend tests for image request parsing, prompt permission text, image SSE event forwarding, and max-image refusal.
- [x] Implement image generation Pydantic models.
- [x] Add prompt instructions only when image generation is enabled.
- [x] Add a nanobot `generate_image` tool that enforces max count and emits image payloads.
- [x] Implement OpenAI-compatible image model call using configured model provider.
- [x] Forward image events from runtime to chat stream as SSE.
- [x] Run targeted backend tests.

### Task 4: Verification

**Files:**
- All changed files.

- [x] Run `pnpm test`.
- [x] Run focused server pytest suite.
- [x] Run `pnpm run build`.
- [x] Review git diff for unrelated changes.
