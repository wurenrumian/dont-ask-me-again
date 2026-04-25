import {
  Menu,
  MarkdownView,
  Notice,
  Plugin,
  TFile
} from "obsidian";

import {
  buildToolRequest,
  invokeResponsesStream,
  invokeToolStream,
  listSessions
} from "./api-client";
import {
  appendUserAndThinkingDraft,
  buildQuotedSelectionInstruction,
  buildQuotedSelectionPrefix,
  buildWrappedSourceLink,
  extractLeadingH1Title,
  extractLeadingH1TitleFromCompletedLine,
  insertTextAtPosition,
  pickPrimaryAnswer,
  finalizeThinkingDraft,
  resolveUniqueMarkdownPath,
  updateAnswerDraft,
  updateThinkingDraft
} from "./file-actions";
import type { ChatDraftAnchor } from "./file-actions";
import { FloatingBox } from "./floating-ui";
import { calculateSelectionMenuLayout } from "./selection-menu-layout";
import {
  captureSelection,
  hasSelection,
  type CachedSelection
} from "./selection-context";
import {
  DEFAULT_SETTINGS,
  DontAskMeAgainSettingTab,
  type DontAskMeAgainSettings
} from "./settings";
import { SessionPickerModal, type SessionPickerItem } from "./session-picker-modal";
import { SessionManager } from "./session-manager";
import { LocalServerManager } from "./local-server-manager";
import { StreamRenderer } from "./stream-renderer";

interface ActiveEditorContext {
  view: MarkdownView;
  editor: MarkdownView["editor"];
  file: TFile;
  selection: CachedSelection;
}

interface DraftRef {
  value: ChatDraftAnchor;
}

interface SelectionActionContext {
  source: ActiveEditorContext;
  target: ActiveEditorContext;
}

export default class DontAskMeAgainPlugin extends Plugin {
  settings!: DontAskMeAgainSettings;
  sessionManager!: SessionManager;

  private floatingBox!: FloatingBox;
  private localServerManager!: LocalServerManager;
  private statusBarEl: HTMLElement | null = null;
  private activeContext: ActiveEditorContext | null = null;
  private selectionDebounceHandle: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.sessionManager = new SessionManager();
    this.localServerManager = new LocalServerManager({
      app: this.app,
      manifestId: this.manifest.id,
      getSettings: () => this.settings
    });
    if (this.settings.autoStartServer) {
      await this.ensureServerRunning(false, { allowAutoStart: true });
    }

    this.floatingBox = new FloatingBox(this, this.buildFloatingBoxOptions());
    this.floatingBox.mount();

    this.addSettingTab(new DontAskMeAgainSettingTab(this.app, this));
    this.addCommands();
    this.registerEditorTemplateMenu();
    this.refreshStatusBar();

    this.registerDomEvent(document, "selectionchange", () => {
      this.scheduleSelectionSync();
    });
    this.registerDomEvent(window, "resize", () => {
      this.updateFloatingDockLayout();
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
    this.floatingBox.updateOptions(this.buildFloatingBoxOptions());
  }

  async ensureServerRunning(
    showNotice = true,
    options?: { allowAutoStart?: boolean }
  ): Promise<boolean> {
    return this.localServerManager.ensureServerRunning(showNotice, options);
  }

  refreshStatusBar(): void {
    this.statusBarEl?.remove();
    this.statusBarEl = null;

    if (!this.settings.showStatusBar) {
      return;
    }

    const statusBarEl = this.addStatusBarItem();
    statusBarEl.setText(this.sessionManager.getStatusLabel());
    const statusBarContainer = document.querySelector(".status-bar");
    if (statusBarContainer) {
      statusBarContainer.prepend(statusBarEl);
    }
    statusBarEl.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("New session").onClick(() => {
          this.startNewSession();
        })
      );
      menu.addItem((item) =>
        item.setTitle("Exit session").onClick(() => {
          this.exitSession();
        })
      );
      menu.addItem((item) =>
        item.setTitle("Manage sessions").onClick(() => {
          void this.openSessionManager();
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
        this.startNewSession();
      }
    });

    this.addCommand({
      id: "exit-session",
      name: "Exit Session",
      callback: () => {
        this.exitSession();
      }
    });

    this.addCommand({
      id: "manage-sessions",
      name: "Manage Sessions",
      callback: () => {
        void this.openSessionManager();
      }
    });

    this.addCommand({
      id: "focus-prompt-box",
      name: "Focus Prompt Box",
      callback: () => {
        this.showFloatingBox(true);
      }
    });

    this.addCommand({
      id: "show-and-focus-prompt-box",
      name: "Show and Focus Prompt Box",
      callback: () => {
        this.showFloatingBox(true);
      }
    });

    this.settings.defaultTemplates.forEach((template, index) => {
      const normalized = template.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const suffix = normalized.length > 0 ? normalized : `template-${index + 1}`;
      this.addCommand({
        id: `use-template-${suffix}-${index + 1}`,
        name: `Use Template: ${template}`,
        callback: () => {
          this.applyTemplateToInput(template);
        }
      });
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
    if (!context) {
      this.syncFloatingBoxFromContext(null, false);
      return;
    }
    this.syncFloatingBoxFromContext(context, true);
  }

  private showFloatingBox(focusInput = false): void {
    const context = this.captureActiveContext();
    this.syncFloatingBoxFromContext(context, false);
    this.floatingBox.showDocked();

    if (focusInput) {
      this.floatingBox.focusInput();
    }
  }

  private buildFloatingBoxOptions(): ConstructorParameters<typeof FloatingBox>[1] {
    return {
      templates: this.settings.defaultTemplates,
      mode: this.settings.selectionUiMode,
      onSubmit: async ({ instruction }) => {
        await this.handleSubmit(instruction);
      },
      onTemplateFromSelection: async (template) => this.handleTemplateFromSelection(template)
    };
  }

  private startNewSession(): void {
    this.sessionManager.beginNewSession();
    this.refreshStatusBar();
    new Notice("Next request will create a new session.");
    this.showFloatingBox(true);
  }

  private exitSession(): void {
    this.sessionManager.clearActiveSessionId();
    this.refreshStatusBar();
    new Notice("Session cleared.");
  }

  private async openSessionManager(): Promise<void> {
    const serverReady = await this.ensureServerRunning(false);
    if (!serverReady) {
      new Notice("Local server is unavailable.");
      return;
    }

    try {
      const response = await listSessions(this.settings.serverBaseUrl, 120);
      new SessionPickerModal(this.app, {
        sessions: response.entries.map((entry) => ({
          sessionId: entry.session_id,
          title: entry.title,
          updatedAt: entry.updated_at
        })),
        activeSessionId: this.sessionManager.getActiveSessionId(),
        onChoose: (item) => {
          this.applySessionPickerAction(item);
        }
      }).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown session list error";
      new Notice(`Failed to load sessions: ${message}`);
    }
  }

  private applySessionPickerAction(item: SessionPickerItem): void {
    if (item.type === "new") {
      this.startNewSession();
      return;
    }

    if (item.type === "clear") {
      this.exitSession();
      return;
    }

    this.sessionManager.setActiveSessionId(item.sessionId);
    this.refreshStatusBar();
    new Notice(`Switched to session: ${item.sessionId}`);
  }

  private syncFloatingBoxFromContext(
    context: ActiveEditorContext | null,
    includeQuoteAnchor: boolean
  ): void {
    this.activeContext = context;
    this.floatingBox.setHost(context?.view.containerEl ?? null);
    this.floatingBox.setContextFile(context?.file.path ?? "");

    const selected = Boolean(context && hasSelection(context.selection));
    this.floatingBox.setSelectionActive(selected);

    if (includeQuoteAnchor && selected) {
      const layout = this.getSelectionActionAnchor();
      if (layout) {
        this.floatingBox.setSelectionActionLayout(
          layout.actionLeft,
          layout.actionTop,
          layout.menuLeft,
          layout.menuWidth,
          layout.placement,
          layout.vPlacement
        );
      }
    }

    this.updateFloatingDockLayout();
  }

  private applyTemplateToInput(template: string): void {
    this.floatingBox.setInputValue(template);
    this.showFloatingBox(true);
  }

  private appendSelectionQuoteToInput(selectionText: string): void {
    const prefix = buildQuotedSelectionPrefix(selectionText);
    if (!prefix) {
      return;
    }

    const currentValue = this.floatingBox.getInputValue();
    this.floatingBox.setInputValue(`${currentValue}${prefix}`);
    this.showFloatingBox(true);
  }

  private buildSelectionTemplateInstruction(template: string): string {
    return [
      template.trim(),
      "",
      "请基于我在源笔记里选中的文本生成一个新笔记。",
      "回答必须从第一行开始就是一级标题（格式：# 标题）。",
      "这个标题会被用作新笔记文件名。",
      "标题必须是可作为文件名的纯文字描述。",
      "不要包含路径、扩展名、Markdown 标记、引号或以下字符：\\ / : * ? \" < > |。",
      "标题后继续输出完整的 Markdown 正文内容。"
    ].join("\n");
  }

  private async createAndSwitchToUntitledNote(directory: string): Promise<ActiveEditorContext | null> {
    const path = await resolveUniqueMarkdownPath(this.app, "untitled", directory);
    const created = await this.app.vault.create(path, "");
    const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(created);
    this.app.workspace.setActiveLeaf(leaf, true, true);
    return this.captureActiveContext();
  }

  private async insertWrappedLinkAfterSelectionInSourceFile(
    context: ActiveEditorContext,
    filename: string
  ): Promise<void> {
    const insertion = buildWrappedSourceLink(filename);
    const anchor = context.selection.to ?? context.selection.from;
    if (!anchor) {
      return;
    }

    await this.app.vault.process(context.file, (content) => {
      return insertTextAtPosition(content, anchor, insertion);
    });
  }

  private async renameNoteByTitle(
    context: ActiveEditorContext,
    title: string,
    directory: string
  ): Promise<string> {
    const nextPath = await resolveUniqueMarkdownPath(this.app, title, directory);
    if (nextPath !== context.file.path) {
      await this.app.fileManager.renameFile(context.file, nextPath);
    }
    return nextPath.replace(/\.md$/i, "");
  }

  private async renameNoteFromAnswer(
    context: ActiveEditorContext,
    answer: string,
    directory: string
  ): Promise<string | null> {
    const title = extractLeadingH1Title(answer);
    if (!title) {
      return null;
    }
    return this.renameNoteByTitle(context, title, directory);
  }

  private getParentFolder(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const splitIndex = normalized.lastIndexOf("/");
    if (splitIndex <= 0) {
      return "";
    }
    return normalized.slice(0, splitIndex);
  }

  private async handleTemplateFromSelection(template: string): Promise<void> {
    const source = this.captureActiveContext();
    if (!source || !hasSelection(source.selection)) {
      new Notice("Select text first.");
      return;
    }

    this.syncFloatingBoxFromContext(source, false);
    const sourceFolder = this.getParentFolder(source.file.path);

    try {
      const target = await this.createAndSwitchToUntitledNote(sourceFolder);
      if (!target) {
        new Notice("Failed to open untitled note.");
        return;
      }

      const selectionContext: SelectionActionContext = { source, target };
      const instruction = this.buildSelectionTemplateInstruction(template);
      let resolvedStem: string | null = null;
      let linkInserted = false;
      let linkInsertPromise: Promise<void> | null = null;
      const ensureLinkInsertedOnce = async (stem: string): Promise<void> => {
        if (linkInserted) {
          return;
        }
        if (linkInsertPromise) {
          await linkInsertPromise;
          return;
        }

        // Set insertion promise before awaiting to avoid duplicate inserts from concurrent callbacks.
        linkInsertPromise = (async () => {
          await this.insertWrappedLinkAfterSelectionInSourceFile(selectionContext.source, stem);
          linkInserted = true;
        })();

        try {
          await linkInsertPromise;
        } finally {
          linkInsertPromise = null;
        }
      };
      const answer = await this.handleSubmit(instruction, {
        context: selectionContext.target,
        selectionTextOverride: selectionContext.source.selection.text,
        onAnswerProgress: async (partialAnswer) => {
          if (resolvedStem && linkInserted) {
            return;
          }
          const earlyTitle = extractLeadingH1TitleFromCompletedLine(partialAnswer);
          if (!earlyTitle) {
            return;
          }
          if (!resolvedStem) {
            resolvedStem = await this.renameNoteByTitle(
              selectionContext.target,
              earlyTitle,
              sourceFolder
            );
          }
          await ensureLinkInsertedOnce(resolvedStem);
        }
      });
      if (answer === null) {
        return;
      }

      const finalMarkdown = answer.endsWith("\n") ? answer : `${answer}\n`;
      selectionContext.target.editor.setValue(finalMarkdown);
      selectionContext.target.editor.setCursor({ line: 0, ch: 0 });

      const renamedStem = resolvedStem ?? await this.renameNoteFromAnswer(
        selectionContext.target,
        answer,
        sourceFolder
      );
      if (!renamedStem) {
        new Notice("No leading # title found, keeping untitled note name.");
        return;
      }

      if (linkInsertPromise) {
        await linkInsertPromise;
      }
      if (!linkInserted) {
        await ensureLinkInsertedOnce(renamedStem);
      }
      new Notice(`Linked source to (${renamedStem}).`);
    } finally {
      this.showFloatingBox(true);
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
      view,
      editor,
      file,
      selection: captureSelection(editor)
    };
  }

  private registerEditorTemplateMenu(): void {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = captureSelection(editor);
        const hasSelectedText = hasSelection(selection);

        if (!hasSelectedText && this.settings.defaultTemplates.length === 0) {
          return;
        }

        menu.addSeparator();
        if (hasSelectedText) {
          menu.addItem((item) =>
            item.setTitle("Quote Selection").onClick(() => {
              this.appendSelectionQuoteToInput(selection.text);
            })
          );
        }
        this.settings.defaultTemplates.forEach((template) => {
          menu.addItem((item) =>
            item.setTitle(`Use Template: ${template}`).onClick(() => {
              const instruction = hasSelectedText
                ? buildQuotedSelectionInstruction(selection.text, template)
                : template;
              void this.handleSubmit(instruction);
            })
          );
        });
      })
    );
  }

  private updateFloatingDockLayout(): void {
    const rect = this.getActiveMarkdownTabRect();
    if (!rect) {
      return;
    }

    const horizontalPadding = 24;
    const maxAllowedWidth = Math.max(260, rect.width - horizontalPadding * 2);
    const width = Math.min(Math.max(rect.width * 0.82, 260), maxAllowedWidth);
    this.floatingBox.setDockLayout(width);
  }

  private getActiveMarkdownTabRect(): DOMRect | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.containerEl) {
      return null;
    }

    const rect = view.containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return rect;
  }

  private async handleSubmit(
    instruction: string,
    options?: {
      context?: ActiveEditorContext;
      selectionTextOverride?: string;
      onAnswerProgress?: (answer: string) => Promise<void> | void;
    }
  ): Promise<string | null> {
    const context = options?.context ?? this.activeContext ?? this.captureActiveContext();
    if (!context) {
      new Notice("No active markdown editor.");
      return null;
    }

    this.activeContext = context;
    this.floatingBox.setBusy(true);
    this.floatingBox.setError("");

    try {
      const serverReady = await this.ensureServerRunning(false);
      if (!serverReady) {
        throw new Error("Local server is unavailable.");
      }

      const fileContent = await this.app.vault.cachedRead(context.file);
      const selectionText = options?.selectionTextOverride ?? context.selection.text;
      const request = buildToolRequest(
        crypto.randomUUID(),
        this.sessionManager.getActiveSessionId(),
        {
          activeFilePath: context.file.path,
          activeFileContent: fileContent,
          selectionText,
          instruction
        },
        this.settings.titleGenerationModelId
      );
      const responsesRequest = {
        model: "",
        session_id: this.sessionManager.getActiveSessionId(),
        title_generation_model_id: this.settings.titleGenerationModelId,
        stream: true,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: this.buildResponsesInput(
                  context.file.path,
                  fileContent,
                  selectionText,
                  instruction
                )
              }
            ]
          }
        ]
      };

      let thinking = "";
      let answer = "";
      let streamError: Error | null = null;
      const draftRef: DraftRef = {
        value: appendUserAndThinkingDraft(context.editor, context.file.path, instruction)
      };
      const renderer = new StreamRenderer({
        updateThinking: (text) => {
          draftRef.value = updateThinkingDraft(context.editor, draftRef.value, text);
        },
        updateAnswer: (text) => {
          draftRef.value = updateAnswerDraft(context.editor, draftRef.value, text);
        },
        onChanged: () => {
          this.scrollContextToBottom(context);
        }
      });

      this.scrollContextToBottom(context);

      this.floatingBox.clearStreamOutput();
      const streamRunner = this.settings.apiFormatMode === "openai-responses"
        ? invokeResponsesStream
        : invokeToolStream;
      const streamPayload = this.settings.apiFormatMode === "openai-responses"
        ? responsesRequest
        : request;

      await streamRunner(this.settings.serverBaseUrl, streamPayload, (event) => {
        if (event.type === "session") {
          if (event.sessionId) {
            this.sessionManager.setActiveSessionId(event.sessionId);
            this.refreshStatusBar();
          }
          return;
        }
        if (event.type === "thinking_delta") {
          thinking += event.text;
          if (options?.onAnswerProgress && answer.trim().length === 0) {
            void options.onAnswerProgress(thinking);
          }
          renderer.pushThinking(event.text);
          return;
        }
        if (event.type === "answer_delta") {
          answer += event.text;
          if (options?.onAnswerProgress) {
            void options.onAnswerProgress(answer);
          }
          renderer.pushAnswer(event.text);
          return;
        }
        if (event.type === "done") {
          if (event.answer && event.answer !== answer) {
            answer = event.answer;
          }
          renderer.finish();
          return;
        }
        if (event.type === "error") {
          streamError = new Error(event.error.message);
          renderer.finish();
        }
      });

      renderer.finish();
      await renderer.waitForDrain();

      if (streamError) {
        const currentStreamError = streamError as Error;
        finalizeThinkingDraft(
          context.editor,
          draftRef.value,
          `请求失败：${currentStreamError.message}`
        );
        throw currentStreamError;
      }

      const primaryAnswer = pickPrimaryAnswer(answer, thinking);
      draftRef.value = updateAnswerDraft(context.editor, draftRef.value, primaryAnswer);
      finalizeThinkingDraft(context.editor, draftRef.value, primaryAnswer);
      this.scrollContextToBottom(context);
      return primaryAnswer;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown request failure.";
      this.floatingBox.setError(message);
      new Notice(message);
      return null;
    } finally {
      this.floatingBox.setBusy(false);
    }
  }

  private getSelectionActionAnchor(): ReturnType<typeof calculateSelectionMenuLayout> | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const hostRect = this.getActiveMarkdownTabRect();
    if (!hostRect) {
      return null;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    const margin = 8;
    return calculateSelectionMenuLayout({
      anchorLeft: rect.right - hostRect.left + margin,
      anchorTop: rect.bottom - hostRect.top + margin,
      anchorBottom: rect.top - hostRect.top - margin,
      hostWidth: hostRect.width,
      hostHeight: hostRect.height
    });
  }

  private scrollContextToBottom(context: ActiveEditorContext): void {
    window.requestAnimationFrame(() => {
      const scroller = context.view.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }

  private buildResponsesInput(
    activeFilePath: string,
    activeFileContent: string,
    selectionText: string,
    instruction: string
  ): string {
    const selectionBlock = selectionText.trim().length > 0
      ? `Selected text in current file:\n${selectionText}\n\n`
      : "";
    return [
      "You are an assistant chatting inside Obsidian for one active note.",
      "The active note is shown below as @active_file.",
      "Provide practical markdown answer text.",
      "Output rules for Obsidian:",
      "- The final answer must be valid Markdown suitable for direct insertion into a note.",
      "- Do not wrap the entire answer in a single fenced code block unless the user explicitly asks.",
      "- For inline math, use MathJax inline form: $...$.",
      "- For block math, use MathJax block form on separate lines: $$...$$.",
      "- Do not use \\(...\\) or \\[...\\] delimiters.",
      "",
      `@active_file path:\n${activeFilePath}`,
      "",
      `@active_file content:\n${activeFileContent}`,
      "",
      selectionBlock,
      `User instruction:\n${instruction}`
    ].join("\n");
  }

}
