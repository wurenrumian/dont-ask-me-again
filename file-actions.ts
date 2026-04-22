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
