# dont-ask-me-again Server V1 Design

## Goal

Build a local server that sits between the Obsidian plugin and the AI runtime, manages session state, invokes a vendored `nanobot` runtime, and returns a stable provider-agnostic result contract to the plugin.

## Core Constraints

- The plugin must never depend on Anthropic-native or OpenAI-native response formats.
- The server must own all provider/runtime adaptation.
- `nanobot` must be managed as a git submodule inside this repository.
- The server must return a strict business result:
  - `session_id`
  - `filename`
  - `markdown`
- The server must be able to reject malformed runtime output deterministically.

## Architecture

V1 server stack:

- Python 3.11+
- FastAPI
- Pydantic
- SQLite for session persistence
- `nanobot` vendored as `vendor/nanobot/`

Repository layout:

- `server/`
  - `app.py`
  - `config.py`
  - `schemas.py`
  - `session_store.py`
  - `prompt_builder.py`
  - `result_normalizer.py`
  - `runtime/`
    - `nanobot_adapter.py`
- `vendor/nanobot/`
  - git submodule pinned to a specific commit

## Why the Server Owns the Boundary

The plugin has a narrow business concern:

- send note context
- send optional selected text
- send user instruction
- receive a generated note target

The runtime has a different concern:

- model-specific message shapes
- tool orchestration details
- provider-specific state
- runtime-specific execution objects

These concerns must not leak into the plugin. The server is the only layer allowed to understand runtime internals.

## HTTP Contract

### Request

`POST /api/v1/invoke`

```json
{
  "request_id": "uuid",
  "session_id": "optional-string",
  "input": {
    "active_file_path": "string",
    "active_file_content": "string",
    "selection_text": "string",
    "instruction": "string"
  },
  "client": {
    "name": "dont-ask-me-again",
    "version": "0.1.0"
  }
}
```

### Success response

```json
{
  "ok": true,
  "result": {
    "session_id": "string",
    "filename": "string",
    "markdown": "string"
  },
  "error": null
}
```

### Error response

```json
{
  "ok": false,
  "result": null,
  "error": {
    "code": "INVALID_REQUEST|INVALID_AGENT_OUTPUT|MODEL_ERROR|INTERNAL",
    "message": "string",
    "retryable": true
  }
}
```

## Session Model

The plugin session and runtime session are related but not identical.

V1 session record:

```json
{
  "session_id": "sess_123",
  "created_at": "2026-04-22T00:00:00Z",
  "updated_at": "2026-04-22T00:05:00Z",
  "runtime": {
    "kind": "nanobot",
    "provider": "anthropic",
    "model": "claude-sonnet"
  },
  "history": [
    {
      "role": "user",
      "content": "..."
    },
    {
      "role": "assistant",
      "content": "..."
    }
  ]
}
```

Rules:

- `session_id` is created by the server if omitted
- the server stores enough history to continue follow-up turns
- the server decides how much of that history is passed into `nanobot`
- the plugin never sees runtime history directly

## Prompt Construction

The server builds one normalized prompt per plugin invocation.

Prompt inputs:

- active file path
- active file content
- selected text
- user instruction
- prior session history

Prompt contract to the runtime:

- use the note content as source context
- prioritize the selected text when present
- generate a filename suitable for a new Markdown note
- return a Markdown answer body
- do not return explanation outside the required structure

The runtime request should ask for a JSON object with:

```json
{
  "filename": "string",
  "markdown": "string"
}
```

The server, not the plugin, is responsible for parsing and validating that object.

## Result Normalization

The server must never forward raw runtime output to the plugin.

Normalization rules:

- extract or parse a JSON object from the runtime result
- require a non-empty `filename`
- require `markdown`
- sanitize impossible values early
- convert all runtime/output errors into a stable server error shape

If normalization fails:

- do not synthesize a fake filename
- do not synthesize placeholder markdown
- return `INVALID_AGENT_OUTPUT`

## Nanobot Submodule Management

`nanobot` is managed as a git submodule.

Rules:

- submodule path: `vendor/nanobot`
- pin to a specific commit, never to a moving branch reference
- update intentionally, not automatically
- wrap the runtime through `server/runtime/nanobot_adapter.py`
- never import `nanobot` code directly from unrelated server modules

Submodule responsibilities:

- host/runtime layer
- provider execution layer
- possible tool orchestration support

Custom server responsibilities:

- API contract
- session persistence
- prompt building
- result normalization
- plugin-facing stability

## Provider Strategy

V1 may use Anthropic through `nanobot`, but the plugin-facing protocol remains provider-agnostic.

This keeps future migration open:

- OpenAI-backed runtime
- another `nanobot` provider path
- a non-`nanobot` runtime entirely

The only stable boundary is the custom server contract.

## Testing Strategy

Critical server tests:

- request schema validation
- session creation when `session_id` is absent
- session reuse when `session_id` is present
- normalization failure when runtime output omits `filename`
- normalization failure when runtime output omits `markdown`
- successful response mapping from runtime output to plugin contract

Runtime adapter tests should stub the `nanobot` interaction. The server test suite should not depend on live model calls.

## Non-Goals

V1 server does not include:

- remote deployment
- multi-user auth
- streaming token output to the plugin
- rich session browsing APIs
- provider selection UI
- generalized chat endpoint
