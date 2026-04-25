import { describe, expect, it } from "vitest";

import {
  appendUserAndThinkingDraft,
  buildQuotedSelectionInstruction,
  buildQuotedSelectionPrefix,
  buildResolvedMarkdownPath,
  buildSourceReplacement,
  buildWrappedSourceLink,
  extractLeadingH1Title,
  extractLeadingH1TitleFromCompletedLine,
  insertTextAtPosition,
  pickPrimaryAnswer,
  updateThinkingDraft
} from "../src/file-actions";

class FakeEditor {
  value: string;
  private cursor = { line: 0, ch: 0 };

  constructor(value: string) {
    this.value = value;
  }

  getValue() {
    return this.value;
  }

  setValue(value: string) {
    this.value = value;
  }

  lastLine() {
    return this.value.split("\n").length - 1;
  }

  getLine(line: number) {
    return this.value.split("\n")[line] ?? "";
  }

  setCursor(position: { line: number; ch: number }) {
    this.cursor = position;
  }

  getCursor() {
    return this.cursor;
  }

  replaceSelection(text: string) {
    const offset = this.posToOffset(this.cursor);
    this.value = `${this.value.slice(0, offset)}${text}${this.value.slice(offset)}`;
    this.cursor = this.offsetToPos(offset + text.length);
  }

  posToOffset(position: { line: number; ch: number }) {
    const lines = this.value.split("\n");
    let offset = 0;
    for (let i = 0; i < position.line; i += 1) {
      offset += lines[i].length + 1;
    }
    return offset + position.ch;
  }

  offsetToPos(offset: number) {
    const before = this.value.slice(0, offset);
    const lines = before.split("\n");
    return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
  }

  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ) {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
  }
}

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

describe("anchored chat drafts", () => {
  it("updates only the anchored draft when identical text appears earlier", () => {
    const editor = new FakeEditor("Intro");
    const first = appendUserAndThinkingDraft(editor as never, "note.md", "Explain");
    const second = appendUserAndThinkingDraft(editor as never, "note.md", "Explain");

    const updated = updateThinkingDraft(editor as never, second, "reasoning");

    expect(updated.currentBlock).toContain("reasoning");
    expect(editor.value.includes(first.currentBlock)).toBe(true);
    expect(editor.value.endsWith(updated.currentBlock)).toBe(true);
  });
});
