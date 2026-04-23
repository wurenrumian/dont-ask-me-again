import type { Editor, EditorPosition } from "obsidian";

export interface CachedSelection {
  text: string;
  from: EditorPosition | null;
  to: EditorPosition | null;
}

export function buildSelectionAlias(selectionText: string): string {
  return selectionText.trim();
}

export function hasSelection(selection: CachedSelection): boolean {
  return buildSelectionAlias(selection.text).length > 0;
}

export function captureSelection(editor: Editor): CachedSelection {
  return {
    text: editor.getSelection(),
    from: editor.getCursor("from"),
    to: editor.getCursor("to")
  };
}

export function restoreSelection(editor: Editor, selection: CachedSelection): void {
  if (!selection.from) {
    return;
  }

  editor.setSelection(selection.from, selection.to ?? selection.from);
}
