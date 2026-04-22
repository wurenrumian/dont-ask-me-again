# dont-ask-me-again Current Status

## Summary

The repository is now set up as a two-part project:

- an Obsidian plugin in the repository root
- a local Python server in `server/`

The plugin and server communicate through a provider-agnostic HTTP contract. `nanobot` is vendored as a git submodule under `vendor/nanobot/` and is only intended to be used behind the server boundary.

## Current Architecture

### Plugin side

Implemented files:

- `main.ts`
- `floating-ui.ts`
- `settings.ts`
- `session-manager.ts`
- `selection-context.ts`
- `api-client.ts`
- `file-actions.ts`
- `styles.css`

Current plugin responsibilities:

- manage active session state
- show a floating input UI
- capture active note content and selected text
- send a normalized request to the local server
- create a generated note from the server response
- replace selected source text with an Obsidian wikilink alias

### Server side

Implemented files:

- `server/app.py`
- `server/config.py`
- `server/schemas.py`
- `server/session_store.py`
- `server/prompt_builder.py`
- `server/result_normalizer.py`
- `server/runtime/nanobot_adapter.py`

Current server responsibilities:

- validate plugin requests
- create and reuse session IDs
- build a runtime prompt from Obsidian note context
- normalize runtime output into `session_id`, `filename`, and `markdown`
- expose `GET /healthz`
- expose `POST /api/v1/invoke`

## Runtime Integration

`nanobot` has been added as a submodule:

- `vendor/nanobot`

Current status of the runtime adapter:

- the adapter imports `Nanobot` from the vendored source tree
- the adapter uses `Nanobot.from_config(...).run(...)`
- the adapter maps plugin sessions to a prefixed runtime `session_key`

The runtime path is present, but it still needs real end-to-end configuration and live request validation against an actual Nanobot config file.

## Verification Status

### Verified

- `pnpm exec tsc --noEmit`
  - passed
- `server\\.venv\\Scripts\\python.exe -m pytest server\\tests -q`
  - passed
  - result: `4 passed`

### Blocked by local environment

- `pnpm run build`
  - blocked by Node/esbuild `spawn EPERM`
- `pnpm test`
  - blocked by the same process spawning restriction in the current environment

These failures are environment-level process launch issues, not currently known TypeScript type errors.

## Open Work

High-priority next steps:

1. make `server/runtime/nanobot_adapter.py` work with a real Nanobot config and live invocation
2. verify `POST /api/v1/invoke` end to end using the local server
3. finish plugin-to-server integration under real runtime output
4. resolve the local Node `spawn EPERM` issue so plugin build and test commands can run normally

## Current Baseline Commit

Main implementation baseline:

- `8fc8a73` - `feat: scaffold plugin and nanobot-backed server`

This status document is intended to mark the next handoff point after that baseline.
