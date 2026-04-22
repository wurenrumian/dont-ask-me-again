# dont-ask-me-again V1 Design

## Goal

Build a minimal Obsidian plugin that sends the current note context and an optional selection to a session-aware local AI server, creates a new note from the structured response, opens that note in the current tab, and links the original note back to the generated note.

## Product Boundaries

V1 intentionally optimizes for directness over abstraction:

- Keep the plugin code in the repository root.
- Treat the server boundary as a provider-agnostic tool API, not a chat endpoint.
- Treat sessions as first-class runtime state managed by the user.
- Treat generated notes as outputs of tool invocations, not as the session container.
- Prefer deterministic behavior over smart fallback behavior.
- Integrate `nanobot` as an internal runtime dependency, not as the plugin-facing API.

V1 does not include:

- Multi-file project organization inside the plugin repository.
- Automatic session expiration.
- Streaming responses.
- Editing generated notes in place through the plugin UI.
- Rich session history browsing.
- Complex source-note rewrite logic beyond link insertion/replacement.
- Direct exposure of provider-native response formats such as Anthropic content blocks.

## Architecture Decision

V1 uses a three-layer architecture:

- Obsidian plugin in this repository
- Custom local server with a stable HTTP API
- `nanobot` managed as a git submodule and invoked only inside the server boundary

This decision exists to keep the plugin independent from provider-specific formats and from `nanobot`'s internal protocol changes.

### Why `nanobot`

`nanobot` is a better fit than `nanoclaw` for this project because it is not centered on a Claude-first assistant UX. It is closer to a host/runtime layer that can sit behind a custom API. However, it is still not the correct protocol boundary for the plugin:

- it is under active development
- its native runtime objects are not the same as the plugin's business contract
- the plugin needs strict fields: `session_id`, `filename`, and `markdown`

Therefore V1 uses `nanobot` only as an internal runtime layer behind a custom server.

### Why a custom server boundary

The plugin must not be forced to understand:

- Anthropic-native tool/result blocks
- OpenAI-native response objects
- `nanobot` runtime-specific structures

The plugin only needs a stable business result:

- `session_id`
- `filename`
- `markdown`

Keeping this boundary custom allows the server to switch providers or runtimes later without forcing any plugin change.

## Primary User Flow

### Flow A: No selection

1. User opens the floating input box from a command or leaves it docked at the bottom.
2. User types a prompt and submits it.
3. Plugin sends one structured tool request containing:
   - active file path
   - active file content
   - empty selection text
   - user instruction
   - active session ID if one exists
4. Server returns a structured tool result containing:
   - session ID
   - filename
   - markdown
5. Plugin creates a new note at the vault root, resolves filename collisions automatically, opens that note in the current tab, writes the markdown, and inserts `[[filename]]` at the source cursor position.

### Flow B: Selection present

1. User selects text in the editor.
2. Plugin shows the floating box near the selection and preserves the selection range.
3. Floating UI shows template actions and the manual input field.
4. User either clicks a template or types a custom instruction.
5. Plugin sends the same tool request shape as Flow A, but includes the selected text.
6. Server returns the same structured result shape.
7. Plugin creates the new note, opens it in the current tab, writes the markdown, and replaces the selected text with `[[filename|selected text]]`.

## Session Model

Sessions are runtime context identifiers managed by the user.

- The plugin stores `activeSessionId` in plugin state.
- A request includes `session_id` only when the user has entered a session.
- A request without a session ID allows the server to create a new session and return its ID.
- User lifecycle actions are explicit:
  - new session
  - enter session
  - exit session
- Session lifecycle is manual in V1. There is no timeout or automatic rollover.

The critical rule is that the plugin binds operations to session context, not to output files. A single session may produce multiple notes, and a single source note may participate in multiple sessions over time.

Session persistence is owned by the custom server, not by `nanobot` alone. The server may map one plugin session to one internal `nanobot` conversation state, but that mapping is an internal concern.

## Plugin UI

### Floating input box

The floating box is the main interaction surface.

- Default state: docked near the bottom of the page.
- Selection state: move near the current selection.
- It must preserve the source selection when the user moves focus into the floating input.
- It supports:
  - manual prompt entry
  - template buttons
  - submit
  - loading state
  - structured error state

Templates and manual input map to the same internal field: `instruction`.

### Status bar

The status bar is only for session visibility and management.

- Display `No Session` when none is active.
- Display the active session identifier when a session is active.
- Allow:
  - new session
  - exit session
- Do not place prompt submission UI in the status bar.

### Commands

V1 command set:

- `Dont Ask Me Again: Toggle Floating Box`
- `Dont Ask Me Again: New Session`
- `Dont Ask Me Again: Exit Session`
- `Dont Ask Me Again: Focus Prompt Box`

If session switching is implemented later, it should also be command-driven.

## Server Contract

The server must behave like a tool executor with strict structured output.

### Request

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
    "code": "INVALID_ARGUMENTS|INVALID_AGENT_OUTPUT|MODEL_ERROR|INTERNAL",
    "message": "string",
    "retryable": true
  }
}
```

### Contract rules

- `filename`, `markdown`, and `session_id` are required on success.
- The plugin does not infer or synthesize missing result fields.
- The server validates runtime output against a schema before responding.
- If `nanobot` or the underlying model returns invalid content, the server retries internally or returns a structured error.
- The plugin treats any malformed response as a hard failure and does not edit the source note.
- The server may internally use Anthropic-compatible formats, OpenAI-compatible formats, or `nanobot` runtime objects, but none of those shapes are exposed to the plugin.

## Runtime Integration

V1 server runtime rules:

- `nanobot` is vendored as a git submodule
- the submodule is pinned to an explicit commit
- the server owns the adapter that converts plugin input into runtime input
- the server owns the normalizer that converts runtime output into:
  - `session_id`
  - `filename`
  - `markdown`

Submodule management is part of the architecture because `nanobot` is not assumed to be globally installed on the user's system.

Recommended repository layout:

- plugin files in repository root
- server implementation in `server/`
- `nanobot` submodule in `vendor/nanobot/`

## Filename and Note Creation Rules

- The server provides the logical filename.
- The plugin sanitizes invalid path characters.
- The plugin writes the note into the vault root.
- The plugin appends `.md` if needed.
- If a filename collision occurs, the plugin creates a unique variant automatically.
- The plugin derives the Obsidian wikilink target from the final resolved note path.

## Source Note Mutation Rules

These rules are intentionally narrow and deterministic.

- With a selection:
  - replace the selected text with `[[generated-file-name|original selection]]`
- Without a selection:
  - insert `[[generated-file-name]]` at the current cursor
- On any failure after request submission:
  - do not modify the source note

The plugin does not attempt to rewrite surrounding prose or create anchor links in V1.

## Persistence

V1 plugin settings should include:

- `serverBaseUrl`
- `defaultTemplates`
- `selectionUiMode`
- `showStatusBar`
- `floatingBoxDefaultPosition`
- `openResultInCurrentTab`

V1 plugin runtime state should include:

- `activeSessionId`
- `floatingBoxVisible`
- cached editor selection
- cached source file path

V1 server persistence should include:

- session table or file store keyed by `session_id`
- provider/runtime metadata
- prompt and response history required for follow-up turns
- optional mapping from a plugin session to the underlying `nanobot` runtime session

## Error Handling

The plugin should handle the following failure classes explicitly:

- no active file
- unsupported editor state
- network request failure
- malformed server response
- note creation failure
- note write failure
- source note update failure

Each failure should surface a compact user-visible message and leave the source note untouched when the operation cannot complete safely.

## Testing Strategy

V1 should be verified with focused unit tests and a small number of integration-oriented command tests.

Critical coverage:

- request payload construction
- response schema validation
- filename sanitization and collision resolution
- source note replacement with `[[file|alias]]`
- no-selection cursor insertion
- session state transitions
- floating box state transitions between docked and selection-attached modes

## Implementation Decomposition

A clean V1 split is:

- `main.ts`
  - plugin bootstrap, command registration, status bar setup
- `settings.ts`
  - settings shape and defaults
- `session-manager.ts`
  - active session lifecycle
- `selection-context.ts`
  - safe selection capture and restoration helpers
- `floating-ui.ts`
  - floating box rendering and interaction wiring
- `api-client.ts`
  - request/response contract, schema validation, transport
- `file-actions.ts`
  - note creation, collision handling, wikilink generation, source-note mutation

Server-side decomposition:

- `server/app.py`
  - FastAPI entrypoint and route registration
- `server/schemas.py`
  - request and response models
- `server/session_store.py`
  - persistent session state
- `server/runtime/nanobot_adapter.py`
  - adapter around the vendored `nanobot` runtime
- `server/prompt_builder.py`
  - converts Obsidian context into runtime input
- `server/result_normalizer.py`
  - enforces the `filename` and `markdown` output schema

This keeps UI, transport, state, and note mutations separate enough to test without overengineering the plugin.
