import { describe, expect, it } from "vitest";

import {
  buildResolvedMarkdownPath,
  buildSourceReplacement
} from "../src/file-actions";

describe("buildResolvedMarkdownPath", () => {
  it("adds the markdown extension when needed", () => {
    expect(buildResolvedMarkdownPath("answer-note")).toBe("answer-note.md");
  });
});

describe("buildSourceReplacement", () => {
  it("builds an aliased wikilink for selected text", () => {
    expect(buildSourceReplacement("answer-note", "Entropy")).toBe("[[answer-note|Entropy]]");
  });

  it("builds a plain wikilink when no selection exists", () => {
    expect(buildSourceReplacement("answer-note", "")).toBe("[[answer-note]]");
  });
});
