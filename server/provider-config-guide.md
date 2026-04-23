# Provider Config Guide
Provider 配置指南

This project does not lock you to OpenRouter. The server reads `server/nanobot.config.json`, and Nanobot decides which provider to use based on that file.
本项目不限定只能使用 OpenRouter。服务端会读取 `server/nanobot.config.json`，并由 Nanobot 根据该文件选择 provider。

## How to use this guide
## 如何使用本指南

1. Copy example config:
1. 复制示例配置：

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

2. Pick one provider snippet below and replace the `providers` + `agents.defaults` parts.
3. Put secrets in `.env` (repo root or `server/.env`) instead of hardcoding keys.
2. 从下方选择一个 provider 片段，替换 `providers` + `agents.defaults` 部分。
3. 密钥建议写入 `.env`（仓库根目录或 `server/.env`），不要硬编码到配置文件。

---

## A) OpenRouter (recommended default)
## A) OpenRouter（默认推荐）

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "${OPENROUTER_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openrouter",
      "model": "openai/gpt-4.1"
    }
  }
}
```

`.env`:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-...
```

---

## B) Generic API gateway / proxy (OpenAI Chat Completions compatible)
## B) 通用 API 网关 / 中转（OpenAI Chat Completions 兼容）

Use `custom` when your endpoint is chat-completions compatible.
如果你的网关是 chat-completions 兼容接口，使用 `custom`。

```json
{
  "providers": {
    "custom": {
      "apiKey": "${CUSTOM_API_KEY}",
      "apiBase": "https://api.your-gateway.com/v1"
    }
  },
  "agents": {
    "defaults": {
      "provider": "custom",
      "model": "your-model-name"
    }
  }
}
```

`.env`:

```dotenv
CUSTOM_API_KEY=your-key
```

If your local gateway does not require auth, set `"apiKey": null`.
如果你的本地网关不需要鉴权，可设置 `"apiKey": null`。

---

## C) Responses-compatible gateway / Azure OpenAI style
## C) Responses 兼容网关 / Azure OpenAI 风格

Use `azure_openai` when your endpoint expects Responses-style behavior.
如果你的网关是 Responses 风格接口，使用 `azure_openai`。

```json
{
  "providers": {
    "azure_openai": {
      "apiKey": "${AZURE_OPENAI_API_KEY}",
      "apiBase": "https://your-endpoint.openai.azure.com",
      "defaultModel": "gpt-4.1"
    }
  },
  "agents": {
    "defaults": {
      "provider": "azure_openai",
      "model": "gpt-4.1"
    }
  }
}
```

`.env`:

```dotenv
AZURE_OPENAI_API_KEY=...
```

---

## D) Common direct providers
## D) 常见直连 providers

### OpenAI

```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openai",
      "model": "gpt-4.1"
    }
  }
}
```

### Anthropic

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "anthropic",
      "model": "claude-sonnet-4.5"
    }
  }
}
```

### Gemini

```json
{
  "providers": {
    "gemini": {
      "apiKey": "${GEMINI_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "gemini",
      "model": "gemini-2.5-pro"
    }
  }
}
```

### DeepSeek

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "${DEEPSEEK_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "deepseek",
      "model": "deepseek-chat"
    }
  }
}
```

---

## E) Local models (Ollama)
## E) 本地模型（Ollama）

```json
{
  "providers": {
    "ollama": {
      "apiBase": "http://127.0.0.1:11434/v1",
      "apiKey": null
    }
  },
  "agents": {
    "defaults": {
      "provider": "ollama",
      "model": "llama3.2"
    }
  }
}
```

---

## F) MiniMax Token Plan / Coding Plan

If you want to test with MiniMax Token Plan, use `provider: "minimax"`.

如果你要用 MiniMax Token Plan 进行测试，使用 `provider: "minimax"`。

```json
{
  "providers": {
    "minimax": {
      "apiKey": "${MINIMAX_API_KEY}",
      "apiBase": "https://api.minimaxi.com/v1"
    }
  },
  "agents": {
    "defaults": {
      "provider": "minimax",
      "model": "MiniMax-M2.7"
    }
  }
}
```

`.env`:

```dotenv
MINIMAX_API_KEY=your-minimax-key
```

Notes:

- Mainland China token plan (minimaxi.com): keep `apiBase` as `https://api.minimaxi.com/v1`.
- Overseas account (minimax.io): change `apiBase` to `https://api.minimax.io/v1`.
- If you need thinking mode / `reasoningEffort`, switch to `provider: "minimax_anthropic"` and use Anthropic-compatible endpoint.

说明：

- 中国大陆 token plan（minimaxi.com）：`apiBase` 使用 `https://api.minimaxi.com/v1`。
- 海外账号（minimax.io）：将 `apiBase` 改为 `https://api.minimax.io/v1`。
- 如果需要思考模式（`reasoningEffort`），改用 `provider: "minimax_anthropic"`（Anthropic 兼容端点）。

---

## Keep these fields from example config
## 建议保留的示例字段

Keep these fields unless you intentionally want to change behavior:
除非你明确需要改行为，否则建议保留以下字段：

- `agents.defaults.workspace`
- `agents.defaults.maxToolIterations`
- `agents.defaults.temperature`
- `tools.web.enable`
- `tools.exec.enable`
- `tools.restrictToWorkspace`

## Reference
## 参考文档

For the full provider list and latest provider-specific options, see:
完整 provider 列表和最新 provider 特定参数请参考：

- `vendor/nanobot/docs/configuration.md`
