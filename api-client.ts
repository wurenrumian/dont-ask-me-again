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
    filename: z.string().min(1),
    markdown: z.string()
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

export type ToolResponse = z.infer<typeof toolResponseSchema>;

export interface ToolCallArguments {
  activeFilePath: string;
  activeFileContent: string;
  selectionText: string;
  instruction: string;
}

export function parseToolResponse(payload: unknown): ToolResponse {
  return toolResponseSchema.parse(payload);
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
  const response = await requestUrl({
    url: `${baseUrl.replace(/\/$/, "")}/api/v1/invoke`,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(payload)
  });

  return parseToolResponse(response.json);
}
