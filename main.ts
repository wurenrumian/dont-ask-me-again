import {
  Menu,
  MarkdownView,
  Notice,
  Plugin,
  TFile
} from "obsidian";

import { buildToolRequest, invokeTool } from "./api-client";
import {
  applySourceReplacement,
  createGeneratedNote,
  openGeneratedNote
} from "./file-actions";
import { FloatingBox } from "./floating-ui";
import {
  captureSelection,
  hasSelection,
  restoreSelection,
  type CachedSelection
} from "./selection-context";
import {
  DEFAULT_SETTINGS,
  DontAskMeAgainSettingTab,
  type DontAskMeAgainSettings
} from "./settings";
import { SessionManager } from "./session-manager";

interface ActiveEditorContext {
  editor: MarkdownView["editor"];
  file: TFile;
  selection: CachedSelection;
}

const EMPTY_SELECTION: CachedSelection = {
  text: "",
  from: null,
  to: null
};

export default class DontAskMeAgainPlugin extends Plugin {
  settings!: DontAskMeAgainSettings;
  sessionManager = new SessionManager();

  private floatingBox!: FloatingBox;
  private statusBarEl: HTMLElement | null = null;
  private activeContext: ActiveEditorContext | null = null;
  private selectionDebounceHandle: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.floatingBox = new FloatingBox(this, {
      templates: this.settings.defaultTemplates,
      mode: this.settings.selectionUiMode,
      onSubmit: async ({ instruction }) => this.handleSubmit(instruction)
    });
    this.floatingBox.mount();

    this.addSettingTab(new DontAskMeAgainSettingTab(this.app, this));
    this.addCommands();
    this.refreshStatusBar();

    this.registerDomEvent(document, "selectionchange", () => {
      this.scheduleSelectionSync();
    });
  }

  onunload(): void {
    this.floatingBox.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.floatingBox.updateOptions({
      templates: this.settings.defaultTemplates,
      mode: this.settings.selectionUiMode,
      onSubmit: async ({ instruction }) => this.handleSubmit(instruction)
    });
  }

  refreshStatusBar(): void {
    this.statusBarEl?.remove();
    this.statusBarEl = null;

    if (!this.settings.showStatusBar) {
      return;
    }

    const statusBarEl = this.addStatusBarItem();
    statusBarEl.setText(this.sessionManager.getStatusLabel());
    statusBarEl.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("New session").onClick(() => {
          this.sessionManager.beginNewSession();
          this.refreshStatusBar();
          new Notice("Next request will create a new session.");
        })
      );
      menu.addItem((item) =>
        item.setTitle("Exit session").onClick(() => {
          this.sessionManager.clearActiveSessionId();
          this.refreshStatusBar();
          new Notice("Session cleared.");
        })
      );
      menu.addItem((item) =>
        item.setTitle("Focus prompt box").onClick(() => {
          this.showFloatingBox();
        })
      );
      menu.showAtMouseEvent(event);
    });

    this.statusBarEl = statusBarEl;
  }

  private addCommands(): void {
    this.addCommand({
      id: "toggle-floating-box",
      name: "Toggle Floating Box",
      callback: () => {
        if (this.floatingBox.isVisible()) {
          this.floatingBox.hide();
          return;
        }

        this.showFloatingBox();
      }
    });

    this.addCommand({
      id: "new-session",
      name: "New Session",
      callback: () => {
        this.sessionManager.beginNewSession();
        this.refreshStatusBar();
        new Notice("Next request will create a new session.");
      }
    });

    this.addCommand({
      id: "exit-session",
      name: "Exit Session",
      callback: () => {
        this.sessionManager.clearActiveSessionId();
        this.refreshStatusBar();
        new Notice("Session cleared.");
      }
    });

    this.addCommand({
      id: "focus-prompt-box",
      name: "Focus Prompt Box",
      callback: () => {
        this.showFloatingBox(true);
      }
    });
  }

  private scheduleSelectionSync(): void {
    if (this.selectionDebounceHandle !== null) {
      window.clearTimeout(this.selectionDebounceHandle);
    }

    this.selectionDebounceHandle = window.setTimeout(() => {
      this.selectionDebounceHandle = null;
      void this.syncSelectionUi();
    }, 40);
  }

  private async syncSelectionUi(): Promise<void> {
    const context = this.captureActiveContext();
    if (!context || !hasSelection(context.selection)) {
      return;
    }

    this.activeContext = context;

    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();

    if (rect && (rect.width > 0 || rect.height > 0)) {
      this.floatingBox.showNear(rect);
    } else {
      this.floatingBox.showDocked();
    }

    if (this.settings.selectionUiMode === "input-first") {
      this.floatingBox.focusInput();
    }
  }

  private showFloatingBox(focusInput = false): void {
    const context = this.captureActiveContext();
    this.activeContext = context;

    if (context && hasSelection(context.selection)) {
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();

      if (rect && (rect.width > 0 || rect.height > 0)) {
        this.floatingBox.showNear(rect);
      } else {
        this.floatingBox.showDocked();
      }
    } else {
      this.floatingBox.showDocked();
    }

    if (focusInput) {
      this.floatingBox.focusInput();
    }
  }

  private captureActiveContext(): ActiveEditorContext | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const editor = view?.editor;

    if (!view || !file || !editor) {
      return null;
    }

    return {
      editor,
      file,
      selection: captureSelection(editor)
    };
  }

  private async handleSubmit(instruction: string): Promise<void> {
    const context = this.activeContext ?? this.captureActiveContext();
    if (!context) {
      new Notice("No active markdown editor.");
      return;
    }

    this.activeContext = context;
    this.floatingBox.setBusy(true);
    this.floatingBox.setError("");

    try {
      const fileContent = await this.app.vault.cachedRead(context.file);
      const request = buildToolRequest(
        crypto.randomUUID(),
        this.sessionManager.getActiveSessionId(),
        {
          activeFilePath: context.file.path,
          activeFileContent: fileContent,
          selectionText: context.selection.text,
          instruction
        }
      );

      const response = await invokeTool(this.settings.serverBaseUrl, request);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      this.sessionManager.setActiveSessionId(response.result.session_id);
      this.refreshStatusBar();

      const generatedFile = await createGeneratedNote(
        this.app,
        response.result.filename,
        response.result.markdown
      );

      restoreSelection(context.editor, context.selection);
      applySourceReplacement(
        this.app,
        context.editor,
        context.file.path,
        generatedFile,
        context.selection.text
      );

      await openGeneratedNote(
        this.app,
        generatedFile,
        this.settings.openResultInCurrentTab
      );

      this.floatingBox.clearInput();
      this.floatingBox.hide();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown request failure.";
      this.floatingBox.setError(message);
      new Notice(message);
    } finally {
      this.floatingBox.setBusy(false);
    }
  }
}
