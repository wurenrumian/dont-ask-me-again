import { App, Editor, TFile, normalizePath } from "obsidian";
import type { EditorPosition } from "obsidian";

function sanitizeFileStem(filename: string): string {
  const sanitized = filename
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const normalized = sanitized.length > 0 ? sanitized : "untitled";

  // Windows reserved device names cannot be used as filenames.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) {
    return `${normalized}-note`;
  }

  return normalized;
}

function extractFilenameStem(filename: string): string {
  const stem = filename.replace(/\.md$/i, "").trim();
  if (!stem) {
    return "untitled";
  }

  const normalized = stem.replace(/\\/g, "/");
  const basename = normalized.split("/").filter((part) => part.length > 0).at(-1) ?? normalized;
  const prefixedStem = basename.split("-").filter((part) => part.trim().length > 0).at(-1) ?? basename;
  return sanitizeFileStem(prefixedStem) || "untitled";
}

export function extractLeadingH1Title(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmpty) {
    return null;
  }

  const match = firstNonEmpty.trim().match(/^#\s+(.+)$/);
  if (!match) {
    return null;
  }

  const title = match[1].trim();
  return title.length > 0 ? title : null;
}

export function extractLeadingH1TitleFromCompletedLine(markdown: string): string | null {
  const match = markdown.match(/^\s*#\s+([^\n]+)\n/);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  return title.length > 0 ? title : null;
}

export function buildWrappedSourceLink(filename: string): string {
  const stem = extractFilenameStem(filename);
  return `([[${stem}]])`;
}

export function buildQuotedSelectionPrefix(selectionText: string): string {
  const quoted = selectionText.trim();
  return quoted.length > 0 ? `\n引用内容：\n\`\`\`\n${quoted}\n\`\`\`\n` : "";
}

export function buildQuotedSelectionInstruction(
  selectionText: string,
  instruction: string
): string {
  return `${buildQuotedSelectionPrefix(selectionText)}${instruction.trim()}`;
}

export function pickPrimaryAnswer(answer: string, thinking: string): string {
  if (answer.trim().length > 0) {
    return answer;
  }
  return thinking.trim().length > 0 ? thinking : answer;
}

export interface ChatDraftAnchor {
  filePath: string;
  startOffset: number;
  endOffset: number;
  instruction: string;
  currentBlock: string;
}

function offsetAtPosition(content: string, position: EditorPosition): number | null {
  if (position.line < 0 || position.ch < 0) {
    return null;
  }

  let line = 0;
  let ch = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (line === position.line && ch === position.ch) {
      return i;
    }

    const current = content[i];
    if (current === "\r") {
      if (content[i + 1] === "\n") {
        i += 1;
      }
      line += 1;
      ch = 0;
      continue;
    }
    if (current === "\n") {
      line += 1;
      ch = 0;
      continue;
    }
    ch += 1;
  }

  if (line === position.line && ch === position.ch) {
    return content.length;
  }
  return null;
}

export function insertTextAtPosition(
  content: string,
  position: EditorPosition,
  insertion: string
): string {
  const offset = offsetAtPosition(content, position);
  if (offset === null) {
    return content;
  }
  return `${content.slice(0, offset)}${insertion}${content.slice(offset)}`;
}

function moveCursorToEnd(editor: Editor): { lastLineText: string } {
  const lastLine = Math.max(0, editor.lastLine());
  const lastLineText = editor.getLine(lastLine) ?? "";
  editor.setCursor({
    line: lastLine,
    ch: lastLineText.length
  });
  return { lastLineText };
}

function buildDraftBlock(
  instruction: string,
  assistantContent: string
): string {
  return [
    `\n---\n`,
    `**我**: ${instruction.trim()}`,
    "",
    `**Assistant**:\n\n${assistantContent}`
  ].join("\n");
}

function escapeHtmlWithLineBreaks(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
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

export async function resolveUniqueMarkdownPath(
  app: App,
  filename: string,
  directory = ""
): Promise<string> {
  const baseName = buildResolvedMarkdownPath(filename);
  const basePath = directory.trim().length > 0
    ? normalizePath(`${directory}/${baseName}`)
    : normalizePath(baseName);
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
  const { lastLineText } = moveCursorToEnd(editor);
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
  const { lastLineText } = moveCursorToEnd(editor);

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

function editorPosToOffset(editor: Editor, position: EditorPosition): number {
  const api = editor as Editor & { posToOffset?: (position: EditorPosition) => number };
  if (api.posToOffset) {
    return api.posToOffset(position);
  }
  const offset = offsetAtPosition(editor.getValue(), position);
  return offset ?? editor.getValue().length;
}

function editorOffsetToPos(editor: Editor, offset: number): EditorPosition {
  const api = editor as Editor & { offsetToPos?: (offset: number) => EditorPosition };
  if (api.offsetToPos) {
    return api.offsetToPos(offset);
  }

  const content = editor.getValue();
  let line = 0;
  let ch = 0;
  for (let i = 0; i < Math.min(offset, content.length); i += 1) {
    const current = content[i];
    if (current === "\r") {
      if (content[i + 1] === "\n") {
        i += 1;
      }
      line += 1;
      ch = 0;
      continue;
    }
    if (current === "\n") {
      line += 1;
      ch = 0;
      continue;
    }
    ch += 1;
  }
  return { line, ch };
}

function replaceAnchoredDraft(
  editor: Editor,
  anchor: ChatDraftAnchor,
  nextBlock: string
): ChatDraftAnchor {
  const from = editorOffsetToPos(editor, anchor.startOffset);
  const to = editorOffsetToPos(editor, anchor.endOffset);
  editor.replaceRange(nextBlock, from, to);
  anchor.endOffset = anchor.startOffset + nextBlock.length;
  anchor.currentBlock = nextBlock;
  return anchor;
}

export function appendUserAndThinkingDraft(editor: Editor, instruction: string): string;
export function appendUserAndThinkingDraft(
  editor: Editor,
  filePath: string,
  instruction: string
): ChatDraftAnchor;
export function appendUserAndThinkingDraft(
  editor: Editor,
  filePathOrInstruction: string,
  maybeInstruction?: string
): string | ChatDraftAnchor {
  const { lastLineText } = moveCursorToEnd(editor);

  const instruction = maybeInstruction ?? filePathOrInstruction;
  const prefix = lastLineText.length > 0 ? "\n\n" : "";
  const payload = buildDraftBlock(
    instruction,
    `<span style="opacity:0.55;">Streaming Reasoning...</span>\n\n`
  );
  const startOffset = editorPosToOffset(editor, editor.getCursor()) + prefix.length;
  editor.replaceSelection(`${prefix}${payload}`);
  if (maybeInstruction !== undefined) {
    return {
      filePath: filePathOrInstruction,
      startOffset,
      endOffset: startOffset + payload.length,
      instruction,
      currentBlock: payload
    };
  }
  return payload;
}

export function updateThinkingDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  thinking: string
): string;
export function updateThinkingDraft(
  editor: Editor,
  anchor: ChatDraftAnchor,
  thinking: string
): ChatDraftAnchor;
export function updateThinkingDraft(
  editor: Editor,
  currentBlockOrAnchor: string | ChatDraftAnchor,
  instructionOrThinking: string,
  maybeThinking?: string
): string | ChatDraftAnchor {
  const instruction = typeof currentBlockOrAnchor === "string"
    ? instructionOrThinking
    : currentBlockOrAnchor.instruction;
  const thinking = typeof currentBlockOrAnchor === "string"
    ? maybeThinking ?? ""
    : instructionOrThinking;
  const escaped = escapeHtmlWithLineBreaks(thinking);
  const nextBlock = buildDraftBlock(
    instruction,
    `<span style="opacity:0.55;white-space:pre-wrap;">${escaped || "Streaming Reasoning..."}</span>`
  );
  if (typeof currentBlockOrAnchor !== "string") {
    return replaceAnchoredDraft(editor, currentBlockOrAnchor, nextBlock);
  }
  replaceFirstOccurrence(editor, currentBlockOrAnchor, nextBlock);
  return nextBlock;
}

export function finalizeThinkingDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  answer: string
): void;
export function finalizeThinkingDraft(
  editor: Editor,
  anchor: ChatDraftAnchor,
  answer: string
): ChatDraftAnchor;
export function finalizeThinkingDraft(
  editor: Editor,
  currentBlockOrAnchor: string | ChatDraftAnchor,
  instructionOrAnswer: string,
  maybeAnswer?: string
): void | ChatDraftAnchor {
  const instruction = typeof currentBlockOrAnchor === "string"
    ? instructionOrAnswer
    : currentBlockOrAnchor.instruction;
  const answer = typeof currentBlockOrAnchor === "string"
    ? maybeAnswer ?? ""
    : instructionOrAnswer;
  const nextBlock = buildDraftBlock(instruction, answer || "(empty)");
  if (typeof currentBlockOrAnchor !== "string") {
    return replaceAnchoredDraft(editor, currentBlockOrAnchor, nextBlock);
  }
  replaceFirstOccurrence(editor, currentBlockOrAnchor, nextBlock);
}

export function updateAnswerDraft(
  editor: Editor,
  currentBlock: string,
  instruction: string,
  answer: string
): string;
export function updateAnswerDraft(
  editor: Editor,
  anchor: ChatDraftAnchor,
  answer: string
): ChatDraftAnchor;
export function updateAnswerDraft(
  editor: Editor,
  currentBlockOrAnchor: string | ChatDraftAnchor,
  instructionOrAnswer: string,
  maybeAnswer?: string
): string | ChatDraftAnchor {
  const instruction = typeof currentBlockOrAnchor === "string"
    ? instructionOrAnswer
    : currentBlockOrAnchor.instruction;
  const answer = typeof currentBlockOrAnchor === "string"
    ? maybeAnswer ?? ""
    : instructionOrAnswer;
  const nextBlock = buildDraftBlock(instruction, answer || "...");
  if (typeof currentBlockOrAnchor !== "string") {
    return replaceAnchoredDraft(editor, currentBlockOrAnchor, nextBlock);
  }
  replaceFirstOccurrence(editor, currentBlockOrAnchor, nextBlock);
  return nextBlock;
}
