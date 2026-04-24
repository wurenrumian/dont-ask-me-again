import {
  Menu,
  MarkdownView,
  Notice,
  Plugin,
  requestUrl,
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
import { FloatingBox } from "./floating-ui";
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

interface ActiveEditorContext {
  view: MarkdownView;
  editor: MarkdownView["editor"];
  file: TFile;
  selection: CachedSelection;
}

interface StreamRenderState {
  startedAt: number;
  thinkingText: string;
  answerText: string;
  thinkingQueue: string;
  answerQueue: string;
  fallbackThinkingText: string;
  fallbackThinkingCursor: number;
  lastFallbackTickAt: number;
  hasRealThinking: boolean;
  answerStarted: boolean;
  done: boolean;
  rafId: number | null;
  resolveDrain: (() => void) | null;
  drained: Promise<void>;
}

interface DraftRef {
  instruction: string;
  value: string;
}

interface SelectionActionContext {
  source: ActiveEditorContext;
  target: ActiveEditorContext;
}

export default class DontAskMeAgainPlugin extends Plugin {
  settings!: DontAskMeAgainSettings;
  sessionManager!: SessionManager;

  private floatingBox!: FloatingBox;
  private statusBarEl: HTMLElement | null = null;
  private activeContext: ActiveEditorContext | null = null;
  private selectionDebounceHandle: number | null = null;
  private serverLaunchInFlight: Promise<boolean> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.sessionManager = new SessionManager();
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
    if (await this.checkServerHealth()) {
      return true;
    }

    if (!options?.allowAutoStart) {
      return false;
    }

    if (this.serverLaunchInFlight) {
      return this.serverLaunchInFlight;
    }

    this.serverLaunchInFlight = this.launchAndWaitForServer(showNotice);
    const ok = await this.serverLaunchInFlight;
    this.serverLaunchInFlight = null;
    return ok;
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
      const anchor = this.getSelectionActionAnchor();
      if (anchor) {
        this.floatingBox.setQuoteAnchor(anchor.left, anchor.top);
      }
    }

    this.updateFloatingDockLayout();
  }

  private applyTemplateToInput(template: string): void {
    this.floatingBox.setInputValue(template);
    this.showFloatingBox(true);
  }

  private buildSelectionTemplateInstruction(template: string): string {
    return [
      template.trim(),
      "",
      "请基于我在源笔记里选中的文本生成一个新笔记。",
      "回答必须从第一行开始就是一级标题（格式：# 标题）。",
      "这个标题会被用作新笔记文件名。",
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
      this.app.workspace.on("editor-menu", (menu) => {
        if (this.settings.defaultTemplates.length === 0) {
          return;
        }

        menu.addSeparator();
        this.settings.defaultTemplates.forEach((template) => {
          menu.addItem((item) =>
            item.setTitle(`Use Template: ${template}`).onClick(() => {
              void this.handleSubmit(template);
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
      const renderState = this.createStreamRenderState();
      const draftRef: DraftRef = {
        instruction,
        value: appendUserAndThinkingDraft(context.editor, instruction)
      };

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
          this.enqueueThinking(renderState, event.text, context, draftRef);
          return;
        }
        if (event.type === "answer_delta") {
          answer += event.text;
          if (options?.onAnswerProgress) {
            void options.onAnswerProgress(answer);
          }
          this.enqueueAnswer(renderState, event.text, context, draftRef);
          return;
        }
        if (event.type === "done") {
          if (event.answer && event.answer !== answer) {
            answer = event.answer;
          }
          renderState.done = true;
          this.ensureRenderPump(renderState, context, draftRef);
          return;
        }
        if (event.type === "error") {
          streamError = new Error(event.error.message);
          renderState.done = true;
        }
      });

      renderState.done = true;
      this.ensureRenderPump(renderState, context, draftRef);
      await this.waitForDrainWithTimeout(renderState);

      if (streamError) {
        const currentStreamError = streamError as Error;
        finalizeThinkingDraft(
          context.editor,
          draftRef.value,
          instruction,
          `请求失败：${currentStreamError.message}`
        );
        throw currentStreamError;
      }

      const primaryAnswer = pickPrimaryAnswer(answer, thinking);
      draftRef.value = updateAnswerDraft(context.editor, draftRef.value, instruction, primaryAnswer);
      finalizeThinkingDraft(context.editor, draftRef.value, instruction, primaryAnswer);
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

  private async launchAndWaitForServer(showNotice: boolean): Promise<boolean> {
    if (!(window as unknown as { require?: unknown }).require) {
      if (showNotice) {
        new Notice("Auto-start requires desktop Obsidian.");
      }
      return false;
    }

    const command = this.settings.serverStartupCommand.trim();
    if (!command) {
      if (showNotice) {
        new Notice("Server startup command is empty.");
      }
      return false;
    }

    try {
      const req = (window as unknown as { require: (id: string) => unknown }).require;
      const childProcess = req("child_process") as {
        spawn: (
          command: string,
          args: string[],
          options: {
            cwd?: string;
            shell: boolean;
            detached: boolean;
            stdio: "ignore" | "inherit";
            windowsHide: boolean;
          }
        ) => { unref: () => void };
      };

      const cwd = this.resolveServerStartupCwd();
      const showTerminal = this.settings.showServerTerminalOnAutoStart;
      const child = childProcess.spawn(command, [], {
        cwd,
        shell: true,
        detached: !showTerminal,
        stdio: showTerminal ? "inherit" : "ignore",
        windowsHide: !showTerminal
      });
      if (!showTerminal) {
        child.unref();
      }

      for (let i = 0; i < 12; i += 1) {
        await this.sleep(500);
        if (await this.checkServerHealth()) {
          if (showNotice) {
            new Notice("Local server started.");
          }
          return true;
        }
      }

      if (showNotice) {
        new Notice("Local server did not become ready in time.");
      }
      return false;
    } catch (error) {
      if (showNotice) {
        const message = error instanceof Error ? error.message : "Unknown start error.";
        new Notice(`Failed to start local server: ${message}`);
      }
      return false;
    }
  }

  private async checkServerHealth(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.settings.serverBaseUrl.replace(/\/$/, "")}/healthz`,
        method: "GET"
      });
      const json = response.json as { status?: string } | undefined;
      return json?.status === "ok";
    } catch {
      return false;
    }
  }

  private resolveServerStartupCwd(): string | undefined {
    if (this.settings.serverStartupCwd.trim().length > 0) {
      return this.settings.serverStartupCwd.trim();
    }

    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    if (!req) {
      return undefined;
    }

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();
    if (!basePath) {
      return undefined;
    }

    const path = req("path") as { join: (...parts: string[]) => string };
    return path.join(basePath, ".obsidian", "plugins", this.manifest.id);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private getSelectionActionAnchor(): { left: number; top: number } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    const margin = 8;
    const left = Math.min(
      Math.max(rect.right + margin, margin),
      window.innerWidth - 240
    );
    const top = Math.min(
      Math.max(rect.bottom + margin, margin),
      window.innerHeight - 40
    );
    return { left, top };
  }

  private scrollContextToBottom(context: ActiveEditorContext): void {
    window.requestAnimationFrame(() => {
      const scroller = context.view.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }

  private createStreamRenderState(): StreamRenderState {
    const state = {
      startedAt: performance.now(),
      thinkingText: "",
      answerText: "",
      thinkingQueue: "",
      answerQueue: "",
      fallbackThinkingText: "Streaming Reasoning / Streaming Thoughts...",
      fallbackThinkingCursor: 0,
      lastFallbackTickAt: 0,
      hasRealThinking: false,
      answerStarted: false,
      done: false,
      rafId: null,
      resolveDrain: null,
      drained: Promise.resolve()
    } as StreamRenderState;
    state.drained = new Promise<void>((resolve) => {
      state.resolveDrain = resolve;
    });
    return state;
  }

  private enqueueThinking(
    state: StreamRenderState,
    delta: string,
    context: ActiveEditorContext,
    draftRef: DraftRef
  ): void {
    state.hasRealThinking = true;
    if (
      state.fallbackThinkingCursor > 0
      && state.thinkingText === state.fallbackThinkingText.slice(0, state.fallbackThinkingCursor)
    ) {
      state.thinkingText = "";
      state.fallbackThinkingCursor = 0;
    }
    state.thinkingQueue += delta;
    this.ensureRenderPump(state, context, draftRef);
  }

  private enqueueAnswer(
    state: StreamRenderState,
    delta: string,
    context: ActiveEditorContext,
    draftRef: DraftRef
  ): void {
    if (!state.answerStarted && !state.hasRealThinking && delta.trim().length === 0) {
      return;
    }
    state.answerQueue += delta;
    this.ensureRenderPump(state, context, draftRef);
  }

  private ensureRenderPump(
    state: StreamRenderState,
    context: ActiveEditorContext,
    draftRef: DraftRef
  ): void {
    if (state.rafId !== null) {
      return;
    }

    const step = () => {
      state.rafId = null;
      let changed = false;
      const minThinkingVisibleMs = 420;
      const allowSwitchToAnswer = state.hasRealThinking
        || (performance.now() - state.startedAt) >= minThinkingVisibleMs
        || state.fallbackThinkingCursor >= state.fallbackThinkingText.length;
      const computeCharsPerFrame = (queueLen: number): number => {
        // Keep "typing" feel, but avoid multi-second lock for long chunks.
        const adaptive = Math.ceil(queueLen / 28);
        return Math.max(1, Math.min(12, adaptive));
      };

      if (!state.answerStarted && state.thinkingQueue.length > 0) {
        const charsPerFrame = computeCharsPerFrame(state.thinkingQueue.length);
        const chunk = state.thinkingQueue.slice(0, charsPerFrame);
        state.thinkingQueue = state.thinkingQueue.slice(charsPerFrame);
        state.thinkingText += chunk;
        draftRef.value = updateThinkingDraft(
          context.editor,
          draftRef.value,
          draftRef.instruction,
          state.thinkingText
        );
        changed = true;
      }

      if (
        !state.answerStarted
        && !state.done
        && state.thinkingQueue.length === 0
      ) {
        const now = performance.now();
        if (
          state.fallbackThinkingCursor < state.fallbackThinkingText.length
          && now - state.lastFallbackTickAt >= 30
        ) {
          state.fallbackThinkingCursor += 1;
          state.lastFallbackTickAt = now;
          state.thinkingText = state.fallbackThinkingText.slice(0, state.fallbackThinkingCursor);
          draftRef.value = updateThinkingDraft(
            context.editor,
            draftRef.value,
            draftRef.instruction,
            state.thinkingText
          );
          changed = true;
        }
      }

      if (state.answerQueue.length > 0 && allowSwitchToAnswer) {
        state.answerStarted = true;
        const charsPerFrame = computeCharsPerFrame(state.answerQueue.length);
        const chunk = state.answerQueue.slice(0, charsPerFrame);
        state.answerQueue = state.answerQueue.slice(charsPerFrame);
        state.answerText += chunk;
        draftRef.value = updateAnswerDraft(
          context.editor,
          draftRef.value,
          draftRef.instruction,
          state.answerText
        );
        changed = true;
      }

      if (changed) {
        this.scrollContextToBottom(context);
      }

      if (
        state.thinkingQueue.length > 0
        || state.answerQueue.length > 0
        || (!state.done && !state.answerStarted && state.fallbackThinkingCursor < state.fallbackThinkingText.length)
      ) {
        state.rafId = window.requestAnimationFrame(step);
        return;
      }

      if (state.done && state.resolveDrain) {
        const resolve = state.resolveDrain;
        state.resolveDrain = null;
        resolve();
      }
    };

    state.rafId = window.requestAnimationFrame(step);
  }

  private async waitForDrainWithTimeout(
    state: StreamRenderState,
    timeoutMs = 2500
  ): Promise<void> {
    await Promise.race([
      state.drained,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      })
    ]);
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
