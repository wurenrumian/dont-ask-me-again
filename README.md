# dont-ask-me-again

Obsidian plugin + local Python server for tool-driven note generation and editing.

## Requirements

- Node.js 18+
- `pnpm` (for `node_modules`)
- Python 3.11+
- `uv` (for Python virtual environment management)

## Quick Start

### 1) Install plugin dependencies (pnpm)

```powershell
pnpm install
```

### 2) Prepare Python virtual environment (uv)

```powershell
uv venv server/.venv
server/.venv/Scripts/python.exe -m pip install --upgrade pip
uv pip install --python server/.venv/Scripts/python.exe -r server/requirements.txt
```

### 3) Prepare runtime config

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

Provider config examples: see [`server/provider-config-guide.md`](server/provider-config-guide.md)

### 4) Configure environment variables

Create `.env` in repo root (or `server/.env`) and set keys based on your provider:

```dotenv
# Example: OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
```

### 5) Run local server

```powershell
server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

### 6) Build plugin

```powershell
pnpm run build
```

For plugin development:

```powershell
pnpm run dev
```

## Notes

- Python environment should be managed with `uv`.
- JS/TS dependencies should be managed with `pnpm`.
- Local secret files are git-ignored: `.env`, `server/.env`, `server/nanobot.config.json`.
