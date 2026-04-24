import { describe, expect, it } from "vitest";

import {
  buildToolRequest,
  parseSessionListResponse,
  parseProviderConfigResponse,
  parseToolResponse
} from "../src/api-client";
import { SessionPickerModal, type SessionPickerItem } from "../src/session-picker-modal";
import { DEFAULT_SETTINGS as PLUGIN_DEFAULT_SETTINGS } from "../src/settings";

describe("buildToolRequest", () => {
  it("builds the provider-agnostic plugin request shape", () => {
    const request = buildToolRequest("req-1", null, {
      activeFilePath: "note.md",
      activeFileContent: "# Note",
      selectionText: "entropy",
      instruction: "Explain this."
    }, "model-1");

    expect(request).toEqual({
      request_id: "req-1",
      session_id: null,
      title_generation_model_id: "model-1",
      input: {
        active_file_path: "note.md",
        active_file_content: "# Note",
        selection_text: "entropy",
        instruction: "Explain this."
      },
      client: {
        name: "dont-ask-me-again",
        version: "0.1.0"
      }
    });
  });
});

describe("parseToolResponse", () => {
  it("accepts a valid tool response", () => {
    const parsed = parseToolResponse({
      ok: true,
      result: {
        session_id: "session-1",
        thinking: "Let me analyze this.",
        answer: "# Answer"
      },
      error: null
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected a success response.");
    }

    expect(parsed.result.answer).toBe("# Answer");
  });

  it("rejects a success response with no answer", () => {
    expect(() =>
      parseToolResponse({
        ok: true,
        result: {
          session_id: "session-1",
          thinking: "..."
        },
        error: null
      })
    ).toThrow();
  });
});

describe("parseProviderConfigResponse", () => {
  it("accepts a valid provider config success payload", () => {
    const parsed = parseProviderConfigResponse({
      ok: true,
      result: {
        provider: "minimax",
        model: "MiniMax-M2.7",
        api_base: "https://api.minimaxi.com/v1",
        api_key_env: "MINIMAX_API_KEY",
        has_api_key: true
      },
      error: null
    });

    expect(parsed.ok).toBe(true);
  });
});

describe("parseSessionListResponse", () => {
  it("accepts a valid nanobot session list payload", () => {
    const parsed = parseSessionListResponse({
      ok: true,
      entries: [
        {
          session_id: "sess_1",
          title: "Summarize config migration",
          updated_at: "2026-04-24T00:00:00+00:00"
        },
        { session_id: "sess_2", updated_at: null }
      ]
    });

    expect(parsed.entries[0].session_id).toBe("sess_1");
    expect(parsed.entries[0].title).toBe("Summarize config migration");
  });
});

describe("settings defaults", () => {
  it("disables title generation by default", () => {
    expect(PLUGIN_DEFAULT_SETTINGS.titleGenerationModelId).toBeNull();
  });
});

describe("SessionPickerModal labels", () => {
  it("prefers title over session id", () => {
    const item: SessionPickerItem = {
      type: "history",
      sessionId: "sess_1",
      title: "Explain provider sync",
      isActive: false,
      updatedAt: null
    };

    const text = SessionPickerModal.prototype.getItemText.call({}, item);

    expect(text).toContain("Explain provider sync");
    expect(text).not.toContain("sess_1 -");
  });
});
