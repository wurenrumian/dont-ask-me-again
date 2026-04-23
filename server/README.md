# Server README

Local API server for the Obsidian plugin.

## Runtime

- Framework: FastAPI
- Start command:

```powershell
server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

- Health endpoint: `GET /healthz`

## Setup (uv)

1. Create venv:

```powershell
uv venv server/.venv
```

2. Install dependencies:

```powershell
uv pip install --python server/.venv/Scripts/python.exe -r server/requirements.txt
```

3. Prepare config file:

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

4. Configure provider secrets in `.env` (repo root or `server/.env`), for example:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-...
```

## Provider Config

Provider templates and env variable names are documented in:

- [`server/provider-config-guide.md`](provider-config-guide.md)

## Smoke Test

After the server is running:

```powershell
powershell -ExecutionPolicy Bypass -File server/scripts/smoke-invoke.ps1
```

## Troubleshooting

- If `server/nanobot.config.json` is missing, API returns `CONFIG_ERROR`.
- If provider keys are missing, request calls fail with provider authentication errors.
- If port `8787` is occupied, change plugin setting `Server base URL` and start command accordingly.
