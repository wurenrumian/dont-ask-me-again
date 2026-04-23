# Provider Config Guide

This server reads `server/nanobot.config.json` and uses provider settings from that file.

## Quick Flow

1. Create runtime config:

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

2. Replace `providers` and `agents.defaults` sections with one of the examples below.
3. Put secrets in `.env` (repo root or `server/.env`) instead of writing keys in JSON.

## Environment Variable Reference

- OpenRouter: `OPENROUTER_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Gemini: `GEMINI_API_KEY`
- DeepSeek: `DEEPSEEK_API_KEY`
- Generic proxy: `CUSTOM_API_KEY`
- Azure OpenAI style: `AZURE_OPENAI_API_KEY`
- MiniMax: `MINIMAX_API_KEY`

## A) OpenRouter (default recommendation)

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

## B) OpenAI-Compatible Gateway (`custom`)

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

If your gateway does not require auth, set `"apiKey": null`.

## C) Responses-Compatible / Azure Style (`azure_openai`)

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

## D) Direct Provider Examples

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

## E) Local Model via Ollama

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

## F) MiniMax

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

Notes:

- Mainland China token plan: `https://api.minimaxi.com/v1`
- Overseas account: `https://api.minimax.io/v1`
- For reasoning mode with Anthropic-compatible endpoint, use `provider: "minimax_anthropic"`

## Keep From Example Config

Unless you intentionally change behavior, keep:

- `agents.defaults.workspace`
- `agents.defaults.maxToolIterations`
- `agents.defaults.temperature`
- `tools.web.enable`
- `tools.exec.enable`
- `tools.restrictToWorkspace`

## More Provider Options

- `vendor/nanobot/docs/configuration.md`
