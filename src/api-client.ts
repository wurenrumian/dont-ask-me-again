import { requestUrl } from "obsidian";
import { z } from "zod";

export const toolRequestSchema = z.object({
  request_id: z.string(),
  session_id: z.string().nullable().optional(),
  input: z.object({
    active_file_path: z.string(),
    active_file_content: z.string(),
    selection_text: z.string(),
    instruction: z.string()
  }),
  client: z.object({
    name: z.string(),
    version: z.string()
  })
});

const toolSuccessSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    session_id: z.string(),
    thinking: z.string(),
    answer: z.string()
  }),
  error: z.null()
});

const toolErrorSchema = z.object({
  ok: z.literal(false),
  result: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean()
  })
});

export const toolResponseSchema = z.union([toolSuccessSchema, toolErrorSchema]);
export const providerNameSchema = z.enum([
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "minimax",
  "custom",
  "azure_openai",
  "ollama"
]);

export const providerConfigRequestSchema = z.object({
  provider: providerNameSchema,
  model: z.string().min(1),
  api_base: z.string().trim().optional().nullable(),
  api_key: z.string().optional().nullable()
});

const providerConfigSuccessSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    provider: providerNameSchema,
    model: z.string(),
    api_base: z.string().nullable(),
    api_key_env: z.string().nullable(),
    has_api_key: z.boolean()
  }),
  error: z.null()
});

const providerConfigErrorSchema = z.object({
  ok: z.literal(false),
  result: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean()
  })
});

export const providerConfigResponseSchema = z.union([
  providerConfigSuccessSchema,
  providerConfigErrorSchema
]);

// --- Model-Provider Configuration Schemas ---

export const modelProviderEntrySchema = z.object({
  id: z.string().min(1),
  provider: providerNameSchema,
  model: z.string().min(1),
  api_base: z.string().nullable().optional(),
  api_key_env: z.string().nullable().optional(),
  is_default: z.boolean(),
  label: z.string().nullable().optional()
});

export const modelProviderListResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(modelProviderEntrySchema),
  default_id: z.string().nullable()
});

export const modelProviderSaveRequestSchema = z.object({
  id: z.string().nullable().optional(),
  provider: providerNameSchema,
  model: z.string().min(1),
  api_base: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
  label: z.string().nullable().optional()
});

const modelProviderSaveSuccessSchema = z.object({
  ok: z.literal(true),
  entry: modelProviderEntrySchema,
  api_key_env: z.string().nullable(),
  api_key_stored: z.boolean()
});

const modelProviderSaveErrorSchema = z.object({
  ok: z.literal(false),
  result: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean()
  })
});

export const modelProviderSaveResponseSchema = z.union([
  modelProviderSaveSuccessSchema,
  modelProviderSaveErrorSchema
]);

export const modelProviderDeleteRequestSchema = z.object({
  id: z.string().min(1)
});

export const modelProviderDeleteResponseSchema = z.object({
  ok: z.literal(true)
});

export const sessionEntrySchema = z.object({
  session_id: z.string().min(1),
  updated_at: z.string().nullable().optional()
});

export const sessionListResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(sessionEntrySchema)
});

export type ToolResponse = z.infer<typeof toolResponseSchema>;
export type ProviderName = z.infer<typeof providerNameSchema>;
export type ProviderConfigResponse = z.infer<typeof providerConfigResponseSchema>;
export type ModelProviderEntry = z.infer<typeof modelProviderEntrySchema>;
export type ModelProviderListResponse = z.infer<typeof modelProviderListResponseSchema>;
export type ModelProviderSaveRequest = z.infer<typeof modelProviderSaveRequestSchema>;
export type ModelProviderSaveResponse = z.infer<typeof modelProviderSaveResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export interface ToolCallArguments {
  activeFilePath: string;
  activeFileContent: string;
  selectionText: string;
  instruction: string;
}

export type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "done"; answer?: string }
  | {
      type: "error";
      error: { code: string; message: string; retryable: boolean };
    };

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function buildApiUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

async function requestJson(
  url: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown
): Promise<unknown> {
  const response = await requestUrl({
    url,
    method,
    ...(body === undefined
      ? {}
      : {
          contentType: "application/json",
          body: JSON.stringify(body)
        })
  });
  return response.json;
}

export function parseToolResponse(payload: unknown): ToolResponse {
  return toolResponseSchema.parse(payload);
}

export function parseProviderConfigResponse(payload: unknown): ProviderConfigResponse {
  return providerConfigResponseSchema.parse(payload);
}

export function parseModelProviderListResponse(payload: unknown): ModelProviderListResponse {
  return modelProviderListResponseSchema.parse(payload);
}

export function parseModelProviderSaveResponse(payload: unknown): ModelProviderSaveResponse {
  return modelProviderSaveResponseSchema.parse(payload);
}

export function parseSessionListResponse(payload: unknown): SessionListResponse {
  return sessionListResponseSchema.parse(payload);
}

export function buildToolRequest(
  requestId: string,
  sessionId: string | null,
  args: ToolCallArguments
) {
  return toolRequestSchema.parse({
    request_id: requestId,
    session_id: sessionId,
    input: {
      active_file_path: args.activeFilePath,
      active_file_content: args.activeFileContent,
      selection_text: args.selectionText,
      instruction: args.instruction
    },
    client: {
      name: "dont-ask-me-again",
      version: "0.1.0"
    }
  });
}

export async function invokeTool(baseUrl: string, payload: unknown): Promise<ToolResponse> {
  const json = await requestJson(buildApiUrl(baseUrl, "/api/v1/invoke"), "POST", payload);
  return parseToolResponse(json);
}

export async function invokeToolStream(
  baseUrl: string,
  payload: unknown,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const response = await fetch(buildApiUrl(baseUrl, "/api/v1/chat/stream"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let shouldStop = false;
  let answerAccumulated = "";

  const takeNextBlock = (): string | null => {
    const match = buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) {
      return null;
    }
    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    return block;
  };

  const emitEvent = (eventName: string, dataLine: string): void => {
    const data = dataLine ? JSON.parse(dataLine) : {};
    if (eventName === "session") {
      onEvent({ type: "session", sessionId: String(data.session_id ?? "") });
    } else if (eventName === "thinking_delta") {
      onEvent({ type: "thinking_delta", text: String(data.text ?? "") });
    } else if (eventName === "answer_delta") {
      const deltaText = String(data.text ?? "");
      answerAccumulated += deltaText;
      onEvent({ type: "answer_delta", text: deltaText });
    } else if (eventName === "done") {
      const finalAnswer = String(data.answer ?? "");
      if (finalAnswer && finalAnswer.startsWith(answerAccumulated)) {
        const missingTail = finalAnswer.slice(answerAccumulated.length);
        if (missingTail.length > 0) {
          onEvent({ type: "answer_delta", text: missingTail });
          answerAccumulated += missingTail;
        }
      } else if (finalAnswer && finalAnswer !== answerAccumulated) {
        onEvent({ type: "answer_delta", text: finalAnswer });
        answerAccumulated = finalAnswer;
      }
      if (finalAnswer) {
        onEvent({ type: "done", answer: finalAnswer });
      } else {
        onEvent({ type: "done" });
      }
      shouldStop = true;
    } else if (eventName === "error") {
      onEvent({
        type: "error",
        error: {
          code: String(data.code ?? "INTERNAL"),
          message: String(data.message ?? "Unknown stream error"),
          retryable: Boolean(data.retryable)
        }
      });
      shouldStop = true;
    }
  };

  while (true) {
    if (shouldStop) return;
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let block = takeNextBlock();
    while (block !== null) {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (eventLine) {
        emitEvent(eventLine.slice(6).trim(), dataLine);
        if (shouldStop) {
          return;
        }
      }
      block = takeNextBlock();
    }
  }
}

export async function invokeResponsesStream(
  baseUrl: string,
  payload: unknown,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const response = await fetch(buildApiUrl(baseUrl, "/v1/responses"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Responses stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let shouldStop = false;
  let answerAccumulated = "";

  const takeNextBlock = (): string | null => {
    const match = buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) {
      return null;
    }
    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    return block;
  };

  const emitEvent = (eventName: string, dataLine: string): void => {
    const data = dataLine ? JSON.parse(dataLine) : {};
    if (eventName === "response.created") {
      const sessionId = String(data.response?.metadata?.session_id ?? "");
      if (sessionId) {
        onEvent({ type: "session", sessionId });
      }
      return;
    }
    if (eventName === "response.output_text.delta") {
      const deltaText = String(data.delta ?? "");
      answerAccumulated += deltaText;
      onEvent({ type: "answer_delta", text: deltaText });
      return;
    }
    if (eventName === "response.output_text.done") {
      const finalAnswer = String(data.text ?? "");
      if (finalAnswer && finalAnswer.startsWith(answerAccumulated)) {
        const missingTail = finalAnswer.slice(answerAccumulated.length);
        if (missingTail.length > 0) {
          onEvent({ type: "answer_delta", text: missingTail });
          answerAccumulated += missingTail;
        }
      } else if (finalAnswer && finalAnswer !== answerAccumulated) {
        onEvent({ type: "answer_delta", text: finalAnswer });
        answerAccumulated = finalAnswer;
      }
      return;
    }
    if (eventName === "response.completed") {
      const sessionId = String(data.response?.metadata?.session_id ?? "");
      if (sessionId) {
        onEvent({ type: "session", sessionId });
      }
      const completedAnswer = String(
        data.response?.output_text
          ?? data.response?.output?.[0]?.content?.[0]?.text
          ?? ""
      );
      if (completedAnswer) {
        onEvent({ type: "done", answer: completedAnswer });
      } else {
        onEvent({ type: "done" });
      }
      shouldStop = true;
      return;
    }
    if (eventName === "response.error") {
      onEvent({
        type: "error",
        error: {
          code: String(data.error?.code ?? "INTERNAL"),
          message: String(data.error?.message ?? "Unknown responses stream error"),
          retryable: false
        }
      });
      shouldStop = true;
    }
  };

  while (true) {
    if (shouldStop) return;
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let block = takeNextBlock();
    while (block !== null) {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (eventLine) {
        emitEvent(eventLine.slice(6).trim(), dataLine);
        if (shouldStop) {
          return;
        }
      }
      block = takeNextBlock();
    }
  }
}

export async function saveProviderConfig(
  baseUrl: string,
  payload: z.input<typeof providerConfigRequestSchema>
): Promise<ProviderConfigResponse> {
  const parsedPayload = providerConfigRequestSchema.parse(payload);
  const json = await requestJson(
    buildApiUrl(baseUrl, "/api/v1/provider-config"),
    "POST",
    parsedPayload
  );
  return parseProviderConfigResponse(json);
}

// --- Model-Provider Configuration API ---

export async function listModelProviders(
  baseUrl: string
): Promise<ModelProviderListResponse> {
  const json = await requestJson(buildApiUrl(baseUrl, "/api/v1/model-providers"), "GET");
  return parseModelProviderListResponse(json);
}

export async function saveModelProvider(
  baseUrl: string,
  payload: z.input<typeof modelProviderSaveRequestSchema>
): Promise<ModelProviderSaveResponse> {
  const parsedPayload = modelProviderSaveRequestSchema.parse(payload);
  const json = await requestJson(
    buildApiUrl(baseUrl, "/api/v1/model-providers"),
    "POST",
    parsedPayload
  );
  return parseModelProviderSaveResponse(json);
}

export async function deleteModelProvider(
  baseUrl: string,
  id: string
): Promise<z.infer<typeof modelProviderDeleteResponseSchema>> {
  const parsedPayload = modelProviderDeleteRequestSchema.parse({ id });
  const json = await requestJson(
    buildApiUrl(baseUrl, "/api/v1/model-providers"),
    "DELETE",
    parsedPayload
  );
  return modelProviderDeleteResponseSchema.parse(json);
}

export async function listSessions(
  baseUrl: string,
  limit = 100
): Promise<SessionListResponse> {
  const normalizedLimit = Math.max(1, Math.min(limit, 500));
  const json = await requestJson(
    buildApiUrl(baseUrl, `/api/v1/sessions?limit=${normalizedLimit}`),
    "GET"
  );
  return parseSessionListResponse(json);
}
