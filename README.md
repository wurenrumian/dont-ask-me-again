# dont-ask-me-again

Obsidian plugin + local FastAPI server for session-aware AI note generation.

## Current Status

- Plugin entry: `src/main.ts`
- Local server entry: `server/app.py`
- Default server URL: `http://127.0.0.1:8787`
- Vendor submodule: `vendor/nanobot`
- `vendor/nanobot/webui` has been removed in this repo to keep scope focused on Obsidian plugin + API server.

## Environment Rules

- Python virtual environment is managed with `uv`.
- Node dependencies (`node_modules`) are managed with `pnpm`.

## Requirements

- Node.js 18+
- `pnpm` 10+
- Python 3.11+
- `uv`

## Quick Start (Windows PowerShell)

1. Install Node dependencies:

```powershell
pnpm install
```

2. Create Python venv and install server dependencies:

```powershell
uv venv server/.venv
uv pip install --python server/.venv/Scripts/python.exe -r server/requirements.txt
```

3. Prepare runtime config:

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

4. Configure model providers in the plugin settings UI. Provider keys are stored locally in `server/provider_secrets.json`.

5. Start local API server:

```powershell
server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

6. Build plugin:

```powershell
pnpm run build
```

## Development Commands

```powershell
pnpm run dev
pnpm run test
pnpm run build
```

## Configuration Docs

- Server operation: [`server/README.md`](server/README.md)

## Git-Ignored Local Files

- `.env`
- `server/.env`
- `server/nanobot.config.json`
- `server/model_providers.json`
- `server/provider_secrets.json`
- `server/.venv`
