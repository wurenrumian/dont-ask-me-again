import { App, Editor, TFile, normalizePath } from "obsidian";

function sanitizeFileStem(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]/g, "-").trim();
}

export function buildResolvedMarkdownPath(filename: string): string {
  const stem = sanitizeFileStem(filename).replace(/\.md$/i, "") || "untitled";
  return `${stem}.md`;
}

export function buildSourceReplacement(filename: string, selectionText: string): string {
  const stem = buildResolvedMarkdownPath(filename).replace(/\.md$/i, "");
  const alias = selectionText.trim();

  return alias.length > 0 ? `[[${stem}|${alias}]]` : `[[${stem}]]`;
}

export async function resolveUniqueMarkdownPath(app: App, filename: string): Promise<string> {
  const basePath = buildResolvedMarkdownPath(filename);
  const parsed = basePath.replace(/\.md$/i, "");
  let attempt = 0;

  while (true) {
    const candidate = normalizePath(attempt === 0 ? basePath : `${parsed}-${attempt}.md`);

    if (!app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }

    attempt += 1;
  }
}

export async function createGeneratedNote(
  app: App,
  filename: string,
  markdown: string
): Promise<TFile> {
  const path = await resolveUniqueMarkdownPath(app, filename);
  return app.vault.create(path, markdown);
}

export async function openGeneratedNote(
  app: App,
  file: TFile,
  openInCurrentTab: boolean
): Promise<void> {
  const leaf = app.workspace.getLeaf(!openInCurrentTab);
  await leaf.openFile(file);
  const currentState = leaf.getViewState();
  if (currentState.type === "markdown") {
    await leaf.setViewState({
      ...currentState,
      state: {
        ...currentState.state,
        mode: "preview"
      }
    });
  }
}

export function applySourceReplacement(
  app: App,
  editor: Editor,
  sourcePath: string,
  file: TFile,
  selectionText: string
): void {
  const alias = selectionText.trim();
  const replacement = app.fileManager.generateMarkdownLink(
    file,
    sourcePath,
    undefined,
    alias
  );

  editor.replaceSelection(replacement);
}

export function appendSourceLinkAtEnd(
  app: App,
  editor: Editor,
  sourcePath: string,
  file: TFile
): void {
  const replacement = app.fileManager.generateMarkdownLink(
    file,
    sourcePath,
    undefined,
    ""
  );
  const lastLine = Math.max(0, editor.lastLine());
  const lastLineText = editor.getLine(lastLine) ?? "";
  editor.setCursor({
    line: lastLine,
    ch: lastLineText.length
  });
  const prefix = lastLineText.length > 0 ? "\n\n" : "";
  editor.replaceSelection(`${prefix}${replacement}`);
}

export function replaceFirstOccurrence(
  editor: Editor,
  target: string,
  replacement: string
): boolean {
  if (!target) {
    return false;
  }

  const content = editor.getValue();
  const index = content.indexOf(target);
  if (index < 0) {
    return false;
  }

  editor.setValue(
    content.slice(0, index) + replacement + content.slice(index + target.length)
  );
  return true;
}

export function appendChatTurn(
  editor: Editor,
  instruction: string,
  thinking: string,
  answer: string
): void {
  const lastLine = Math.max(0, editor.lastLine());
  const lastLineText = editor.getLine(lastLine) ?? "";
  editor.setCursor({
    line: lastLine,
    ch: lastLineText.length
  });

  const parts = [
    "",
    "",
    `## User`,
    instruction.trim(),
    "",
    "## Thinking",
    thinking.trim() || "(empty)",
    "",
    "## Assistant",
    answer.trim() || "(empty)"
  ];
  const prefix = lastLineText.length > 0 ? "\n" : "";
  editor.replaceSelection(`${prefix}${parts.join("\n")}\n`);
}

export function appendUserAndThinkingDraft(
  editor: Editor,
  instruction: string
): string {
  const lastLine = Math.max(0, editor.lastLine());
  const lastLineText = editor.getLine(lastLine) ?? "";
  editor.setCursor({
    line: lastLine,
    ch: lastLineText.length
  });

  const prefix = lastLineText.length > 0 ? "\n\n" : "";
  const payload = [
    `---`,
    `**我**: ${instruction.trim()}`,
    "",
    `**Assistant**: <span style="opacity:0.55;">Streaming Reasoning...</span>`
  ].join("\n");
  editor.replaceSelection(`${prefix}${payload}`);
  return payload;
}

export function updateThinkingDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  thinking: string
): string {
  const escaped = thinking
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  const nextBlock = [
    `---`,
    `**我**: ${instruction.trim()}`,
    "",
    `**Assistant**: <span style="opacity:0.55;white-space:pre-wrap;">${escaped || "Streaming Reasoning..."}</span>`
  ].join("\n");
  replaceFirstOccurrence(editor, currentBlock, nextBlock);
  return nextBlock;
}

export function finalizeThinkingDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  answer: string
): void {
  const nextBlock = [
    `---`,
    `**我**: ${instruction.trim()}`,
    "",
    `**Assistant**: ${answer || "(empty)"}`
  ].join("\n");
  replaceFirstOccurrence(editor, currentBlock, nextBlock);
}

export function updateAnswerDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  answer: string
): string {
  const nextBlock = [
    `---`,
    `**我**: ${instruction.trim()}`,
    "",
    `**Assistant**: ${answer || "..."}`
  ].join("\n");
  replaceFirstOccurrence(editor, currentBlock, nextBlock);
  return nextBlock;
}
