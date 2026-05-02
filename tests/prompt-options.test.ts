import { describe, expect, it } from "vitest";

import {
  SelectionPromptBinding,
  buildInstructionWithVerbosity,
  buildSelectionActionItems
} from "../src/prompt-options";

describe("buildSelectionActionItems", () => {
  it("prepends a custom prompt action before templates", () => {
    expect(buildSelectionActionItems(["Explain", "Summarize"])).toEqual([
      { kind: "custom", label: "自定义 prompt" },
      { kind: "template", label: "Explain", template: "Explain" },
      { kind: "template", label: "Summarize", template: "Summarize" }
    ]);
  });
});

describe("buildInstructionWithVerbosity", () => {
  it("appends the most concise guidance at level 0", () => {
    expect(buildInstructionWithVerbosity("解释这段内容", 0)).toContain("尽量简洁");
  });

  it("appends the most detailed guidance at level 5", () => {
    expect(buildInstructionWithVerbosity("解释这段内容", 5)).toContain("超繁");
  });
});

describe("SelectionPromptBinding", () => {
  it("consumes the pending selection once and then clears it", () => {
    const binding = new SelectionPromptBinding();

    binding.set({
      filePath: "note.md",
      selectionText: "selected text"
    });

    expect(binding.consume()?.selectionText).toBe("selected text");
    expect(binding.consume()).toBeNull();
  });

  it("clears the pending selection explicitly", () => {
    const binding = new SelectionPromptBinding();

    binding.set({
      filePath: "note.md",
      selectionText: "selected text"
    });
    binding.clear();

    expect(binding.consume()).toBeNull();
  });
});
