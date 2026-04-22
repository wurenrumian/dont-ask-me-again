import { describe, expect, it } from "vitest";

import { buildToolRequest, parseToolResponse } from "../api-client";

describe("buildToolRequest", () => {
  it("builds the provider-agnostic plugin request shape", () => {
    const request = buildToolRequest("req-1", null, {
      activeFilePath: "note.md",
      activeFileContent: "# Note",
      selectionText: "entropy",
      instruction: "Explain this."
    });

    expect(request).toEqual({
      request_id: "req-1",
      session_id: null,
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
        filename: "answer-note",
        markdown: "# Answer"
      },
      error: null
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected a success response.");
    }

    expect(parsed.result.filename).toBe("answer-note");
  });

  it("rejects a success response with no filename", () => {
    expect(() =>
      parseToolResponse({
        ok: true,
        result: {
          session_id: "session-1",
          markdown: "# Answer"
        },
        error: null
      })
    ).toThrow();
  });
});
