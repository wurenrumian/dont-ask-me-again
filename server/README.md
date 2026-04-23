# Local Server Dev Notes
本地服务端开发说明

## 1) Prepare runtime config
## 1) 准备运行时配置

Create a local runtime config file (ignored by git):
创建本地运行时配置文件（已被 git 忽略）：

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

Pick your provider config style:
选择你的 provider 配置方式：

- OpenRouter / direct providers / local model: see `server/provider-config-guide.md`
- Generic API proxy:
  - Chat-completions compatible -> `custom`
  - Responses-compatible -> `azure_openai`
- OpenRouter / 直连 provider / 本地模型：见 `server/provider-config-guide.md`
- 通用 API 中转：
  - Chat Completions 兼容 -> `custom`
  - Responses 兼容 -> `azure_openai`
- MiniMax Token Plan：见 `server/provider-config-guide.md` 的 `F) MiniMax Token Plan / Coding Plan`

Then set your provider key in the current shell before starting the server, for example:
然后在启动服务前设置 provider key，例如：

```powershell
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
```

Or put it in `.env` (repo root or `server/.env`), for example:
或者写到 `.env`（仓库根目录或 `server/.env`）：

```dotenv
OPENROUTER_API_KEY=sk-or-v1-...
```

## 2) Start the API server
## 2) 启动 API 服务

```powershell
server\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

## 3) Run a smoke invoke request
## 3) 运行一次 smoke invoke 请求

```powershell
powershell -ExecutionPolicy Bypass -File server/scripts/smoke-invoke.ps1
```

If runtime config is missing, API returns `CONFIG_ERROR` to make setup issues explicit.
如果缺少运行时配置，API 会返回 `CONFIG_ERROR`，方便快速定位配置问题。
