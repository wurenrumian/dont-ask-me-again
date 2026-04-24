import { describe, expect, it } from "vitest";

import {
  buildQuotedSelectionInstruction,
  buildQuotedSelectionPrefix,
  buildResolvedMarkdownPath,
  buildSourceReplacement,
  buildWrappedSourceLink,
  extractLeadingH1Title,
  extractLeadingH1TitleFromCompletedLine,
  insertTextAtPosition,
  pickPrimaryAnswer
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

describe("buildQuotedSelectionPrefix", () => {
  it("formats the selected text as a simple quoted prefix", () => {
    expect(buildQuotedSelectionPrefix("Alpha\nBeta")).toBe("引用内容：\nAlpha\nBeta\n\n");
  });

  it("returns empty string when selection is blank", () => {
    expect(buildQuotedSelectionPrefix("   ")).toBe("");
  });
});

describe("buildQuotedSelectionInstruction", () => {
  it("places quoted selection before the template instruction", () => {
    expect(buildQuotedSelectionInstruction("Alpha", "Summarize this")).toBe(
      "引用内容：\nAlpha\n\nSummarize this"
    );
  });

  it("falls back to the template when no selection exists", () => {
    expect(buildQuotedSelectionInstruction("", "Summarize this")).toBe("Summarize this");
  });
});

describe("extractLeadingH1Title", () => {
  it("extracts title from the first non-empty line when it is a h1", () => {
    expect(extractLeadingH1Title("\n# My Note\n\ncontent")).toBe("My Note");
  });

  it("returns null when first non-empty line is not a h1", () => {
    expect(extractLeadingH1Title("## Subtitle\n# Later")).toBeNull();
  });
});

describe("extractLeadingH1TitleFromCompletedLine", () => {
  it("extracts title only when heading line is complete", () => {
    expect(extractLeadingH1TitleFromCompletedLine("# T\nnext")).toBe("T");
    expect(extractLeadingH1TitleFromCompletedLine("# T")).toBeNull();
  });
});

describe("buildWrappedSourceLink", () => {
  it("creates wrapped wikilink payload", () => {
    expect(buildWrappedSourceLink("My Note")).toBe("([[My Note]])");
  });

  it("keeps only the filename stem when prefixed segments are present", () => {
    expect(buildWrappedSourceLink("Folder Name-My Note.md")).toBe("([[My Note]])");
  });
});

describe("insertTextAtPosition", () => {
  it("inserts at a line/ch position", () => {
    const content = "alpha\nbeta";
    expect(insertTextAtPosition(content, { line: 0, ch: 5 }, "([[X]])")).toBe("alpha([[X]])\nbeta");
  });
});

describe("pickPrimaryAnswer", () => {
  it("prefers answer when answer exists", () => {
    expect(pickPrimaryAnswer("A", "T")).toBe("A");
  });

  it("falls back to thinking when answer is empty", () => {
    expect(pickPrimaryAnswer("   ", "# Title\nBody")).toBe("# Title\nBody");
  });
});
