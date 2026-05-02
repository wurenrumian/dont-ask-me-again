export interface PendingSelectionPromptContext {
  filePath: string;
  selectionText: string;
  targetMode: "current-note" | "new-note";
}

export type SelectionActionItem =
  | {
      kind: "custom";
      label: string;
      targetMode: "new-note";
    }
  | {
      kind: "template";
      label: string;
      template: string;
    };

const VERBOSITY_GUIDANCE: Record<number, string> = {
  0: "请尽量简洁，只保留最关键的信息。",
  1: "请偏简洁地回答，优先给出结论和必要说明。",
  2: "请用适中的详细程度回答，兼顾清晰与篇幅。",
  3: "请写得稍微详细一些，补充必要背景和解释。",
  4: "请尽量详细，覆盖关键细节、步骤和注意事项。",
  5: "请使用超繁模式，给出非常详细、充分展开的说明。"
};

export function buildSelectionActionItems(templates: string[]): SelectionActionItem[] {
  return [
    { kind: "custom", label: "自定义 prompt", targetMode: "new-note" },
    ...templates.map((template) => ({
      kind: "template" as const,
      label: template,
      template
    }))
  ];
}

export function buildInstructionWithVerbosity(
  instruction: string,
  verbosityLevel: number
): string {
  const normalizedLevel = Math.max(0, Math.min(5, Math.round(verbosityLevel)));
  const guidance = VERBOSITY_GUIDANCE[normalizedLevel];
  const trimmedInstruction = instruction.trim();

  if (!guidance) {
    return trimmedInstruction;
  }

  return `${trimmedInstruction}\n\n补充要求：${guidance}`;
}

export class SelectionPromptBinding {
  private pending: PendingSelectionPromptContext | null = null;

  set(context: PendingSelectionPromptContext): void {
    this.pending = context;
  }

  consume(): PendingSelectionPromptContext | null {
    const current = this.pending;
    this.pending = null;
    return current;
  }

  clear(): void {
    this.pending = null;
  }
}
