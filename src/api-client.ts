import { requestUrl } from "obsidian";
import { z } from "zod";

export const toolRequestSchema = z.object({
  request_id: z.string(),
  session_id: z.string().nullable().optional(),
  title_generation_model_id: z.string().nullable().optional(),
  image_generation: z.object({
    enabled: z.boolean(),
    model_id: z.string().min(1).optional(),
    max_images: z.number().int().min(1).max(20).optional(),
    size: z.string().min(1).optional(),
    quality: z.string().min(1).optional(),
    output_format: z.string().min(1).optional()
  }).optional(),
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
  "openai_compatible",
  "anthropic",
  "gemini",
  "deepseek",
  "minimax",
  "custom",
  "azure_openai",
  "ollama"
]);

// --- Model-Provider Configuration Schemas ---

export const modelProviderEntrySchema = z.object({
  id: z.string().min(1),
  provider: providerNameSchema,
  provider_id: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  provider_kind: providerNameSchema.nullable().optional(),
  model: z.string().min(1),
  api_base: z.string().nullable().optional(),
  has_api_key: z.boolean().optional().default(false),
  is_default: z.boolean(),
  label: z.string().nullable().optional(),
  capabilities: z.array(z.string()).optional().default(["chat", "title"])
});

export const modelProviderListResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(modelProviderEntrySchema),
  default_id: z.string().nullable()
});

export const modelProviderSaveRequestSchema = z.object({
  id: z.string().nullable().optional(),
  provider: providerNameSchema,
  provider_id: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  model: z.string().min(1),
  api_base: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
  label: z.string().nullable().optional(),
  capabilities: z.array(z.string()).nullable().optional()
});

const modelProviderSaveSuccessSchema = z.object({
  ok: z.literal(true),
  entry: modelProviderEntrySchema,
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
  title: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional()
});

export const sessionListResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(sessionEntrySchema)
});

export type ToolResponse = z.infer<typeof toolResponseSchema>;
export type ProviderName = z.infer<typeof providerNameSchema>;
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

export interface ImageGenerationRequest {
  enabled: boolean;
  modelId?: string;
  maxImages?: number;
  size?: string;
  quality?: string;
  outputFormat?: string;
}

export type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "image_generated"; filename: string; mimeType: string; base64: string }
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

function reconcileFinalAnswerDelta(
  accumulated: string,
  finalAnswer: string
): { deltaToEmit: string; nextAccumulated: string } {
  if (!finalAnswer) {
    return { deltaToEmit: "", nextAccumulated: accumulated };
  }

  if (!accumulated) {
    return { deltaToEmit: finalAnswer, nextAccumulated: finalAnswer };
  }

  if (finalAnswer.startsWith(accumulated)) {
    const missingTail = finalAnswer.slice(accumulated.length);
    return {
      deltaToEmit: missingTail,
      nextAccumulated: `${accumulated}${missingTail}`
    };
  }

  // Streaming chunks may preserve leading/trailing whitespace while final answer is trimmed.
  if (finalAnswer.trim() === accumulated.trim() || accumulated.startsWith(finalAnswer)) {
    return { deltaToEmit: "", nextAccumulated: accumulated };
  }

  return { deltaToEmit: finalAnswer, nextAccumulated: finalAnswer };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSSEDataLines(lines: string[]): unknown {
  if (lines.length === 0) {
    return {};
  }

  const parsed = lines.map((line) => JSON.parse(line));
  if (parsed.length === 1) {
    return parsed[0];
  }

  if (parsed.every((item) => isRecord(item) && typeof item.text === "string")) {
    return {
      ...(parsed[0] as Record<string, unknown>),
      text: parsed.map((item) => String((item as { text: string }).text)).join("")
    };
  }

  if (parsed.every((item) => isRecord(item) && typeof item.delta === "string")) {
    return {
      ...(parsed[0] as Record<string, unknown>),
      delta: parsed.map((item) => String((item as { delta: string }).delta)).join("")
    };
  }

  return parsed.at(-1) ?? {};
}

function getResponsesOutputText(responsePayload: Record<string, unknown>): string {
  if (typeof responsePayload.output_text === "string") {
    return responsePayload.output_text;
  }
  const output = Array.isArray(responsePayload.output) ? responsePayload.output : [];
  const firstOutput = output.find(isRecord);
  const content = firstOutput && Array.isArray(firstOutput.content) ? firstOutput.content : [];
  const firstContent = content.find(isRecord);
  return typeof firstContent?.text === "string" ? firstContent.text : "";
}

async function parseSSEStream(
  response: Response,
  failureMessage: string,
  onMessage: (eventName: string, data: unknown) => boolean | void
): Promise<void> {
  if (!response.ok || !response.body) {
    throw new Error(`${failureMessage}: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeNextBlock = (): string | null => {
    const match = buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) {
      return null;
    }
    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    return block;
  };

  const emitBlock = (block: string): boolean => {
    const lines = block.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    if (!eventLine) {
      return false;
    }
    const data = mergeSSEDataLines(
      lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    );
    return onMessage(eventLine.slice(6).trim(), data) === true;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });

    let block = takeNextBlock();
    while (block !== null) {
      if (emitBlock(block)) {
        return;
      }
      block = takeNextBlock();
    }
  }
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
  args: ToolCallArguments,
  titleGenerationModelId: string | null = null,
  imageGeneration?: ImageGenerationRequest
) {
  return toolRequestSchema.parse({
    request_id: requestId,
    session_id: sessionId,
    title_generation_model_id: titleGenerationModelId,
    ...(imageGeneration
      ? {
          image_generation: {
            enabled: imageGeneration.enabled,
            ...(imageGeneration.modelId ? { model_id: imageGeneration.modelId } : {}),
            ...(imageGeneration.maxImages ? { max_images: imageGeneration.maxImages } : {}),
            ...(imageGeneration.size ? { size: imageGeneration.size } : {}),
            ...(imageGeneration.quality ? { quality: imageGeneration.quality } : {}),
            ...(imageGeneration.outputFormat ? { output_format: imageGeneration.outputFormat } : {})
          }
        }
      : {}),
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

  let answerAccumulated = "";
  await parseSSEStream(response, "Stream request failed", (eventName, payload) => {
    const data = isRecord(payload) ? payload : {};
    if (eventName === "session") {
      onEvent({ type: "session", sessionId: String(data.session_id ?? "") });
    } else if (eventName === "thinking_delta") {
      onEvent({ type: "thinking_delta", text: String(data.text ?? "") });
    } else if (eventName === "answer_delta") {
      const deltaText = String(data.text ?? "");
      answerAccumulated += deltaText;
      onEvent({ type: "answer_delta", text: deltaText });
    } else if (eventName === "image_generated") {
      onEvent({
        type: "image_generated",
        filename: String(data.filename ?? ""),
        mimeType: String(data.mime_type ?? "image/png"),
        base64: String(data.base64 ?? "")
      });
    } else if (eventName === "done") {
      const finalAnswer = String(data.answer ?? "");
      const reconciled = reconcileFinalAnswerDelta(answerAccumulated, finalAnswer);
      if (reconciled.deltaToEmit.length > 0) {
        onEvent({ type: "answer_delta", text: reconciled.deltaToEmit });
      }
      answerAccumulated = reconciled.nextAccumulated;
      if (finalAnswer) {
        onEvent({ type: "done", answer: finalAnswer });
      } else {
        onEvent({ type: "done" });
      }
      return true;
    } else if (eventName === "error") {
      onEvent({
        type: "error",
        error: {
          code: String(data.code ?? "INTERNAL"),
          message: String(data.message ?? "Unknown stream error"),
          retryable: Boolean(data.retryable)
        }
      });
      return true;
    }
    return false;
  });
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

  let answerAccumulated = "";
  await parseSSEStream(response, "Responses stream request failed", (eventName, payload) => {
    const data = isRecord(payload) ? payload : {};
    if (eventName === "response.created") {
      const responsePayload = isRecord(data.response) ? data.response : {};
      const metadata = isRecord(responsePayload.metadata) ? responsePayload.metadata : {};
      const sessionId = String(metadata.session_id ?? "");
      if (sessionId) {
        onEvent({ type: "session", sessionId });
      }
      return false;
    }
    if (eventName === "image_generated") {
      onEvent({
        type: "image_generated",
        filename: String(data.filename ?? ""),
        mimeType: String(data.mime_type ?? "image/png"),
        base64: String(data.base64 ?? "")
      });
      return false;
    }
    if (eventName === "response.output_text.delta") {
      const deltaText = String(data.delta ?? "");
      answerAccumulated += deltaText;
      onEvent({ type: "answer_delta", text: deltaText });
      return false;
    }
    if (eventName === "response.output_text.done") {
      const finalAnswer = String(data.text ?? "");
      const reconciled = reconcileFinalAnswerDelta(answerAccumulated, finalAnswer);
      if (reconciled.deltaToEmit.length > 0) {
        onEvent({ type: "answer_delta", text: reconciled.deltaToEmit });
      }
      answerAccumulated = reconciled.nextAccumulated;
      return false;
    }
    if (eventName === "response.completed") {
      const responsePayload = isRecord(data.response) ? data.response : {};
      const metadata = isRecord(responsePayload.metadata) ? responsePayload.metadata : {};
      const sessionId = String(metadata.session_id ?? "");
      if (sessionId) {
        onEvent({ type: "session", sessionId });
      }
      const completedAnswer = getResponsesOutputText(responsePayload);
      if (completedAnswer) {
        onEvent({ type: "done", answer: completedAnswer });
      } else {
        onEvent({ type: "done" });
      }
      return true;
    }
    if (eventName === "response.error") {
      const error = isRecord(data.error) ? data.error : {};
      onEvent({
        type: "error",
        error: {
          code: String(error.code ?? "INTERNAL"),
          message: String(error.message ?? "Unknown responses stream error"),
          retryable: false
        }
      });
      return true;
    }
    return false;
  });
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
