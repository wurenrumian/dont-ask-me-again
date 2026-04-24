import type { Plugin } from "obsidian";

import type { SelectionUiMode } from "./settings";

export interface FloatingSubmitPayload {
  instruction: string;
}

export interface FloatingBoxOptions {
  templates: string[];
  mode: SelectionUiMode;
  onSubmit: (payload: FloatingSubmitPayload) => Promise<void>;
  onTemplateFromSelection: (template: string) => Promise<void>;
}

export class FloatingBox {
  private rootEl: HTMLDivElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private contextEl: HTMLDivElement | null = null;
  private thinkingEl: HTMLPreElement | null = null;
  private answerEl: HTMLPreElement | null = null;
  private selectionActionEl: HTMLDivElement | null = null;
  private selectionIconBtnEl: HTMLButtonElement | null = null;
  private templateMenuEl: HTMLDivElement | null = null;
  private menuCloseTimer: number | null = null;
  private hostEl: HTMLElement | null = null;
  private mounted = false;
  private selectionActive = false;
  private busy = false;

  constructor(
    private readonly plugin: Plugin,
    private options: FloatingBoxOptions
  ) {}

  mount(): void {
    if (this.mounted) {
      return;
    }

    this.rootEl = document.createElement("div");
    this.rootEl.className = "dama-floating-box dama-hidden dama-docked";
    this.rootEl.dataset.selectionActive = "false";

    this.inputEl = document.createElement("textarea");
    this.inputEl.className = "dama-floating-input";
    this.inputEl.placeholder = "Ask the tool server...";
    this.inputEl.rows = 2;
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.submit();
      }
    });

    this.errorEl = document.createElement("div");
    this.errorEl.className = "dama-floating-error";

    this.contextEl = document.createElement("div");
    this.contextEl.className = "dama-floating-context";

    this.thinkingEl = document.createElement("pre");
    this.thinkingEl.className = "dama-floating-thinking dama-hidden";

    this.answerEl = document.createElement("pre");
    this.answerEl.className = "dama-floating-answer dama-hidden";

    this.selectionActionEl = document.createElement("div");
    this.selectionActionEl.className = "dama-selection-action dama-hidden";

    this.selectionIconBtnEl = document.createElement("button");
    this.selectionIconBtnEl.className = "dama-selection-icon";
    this.selectionIconBtnEl.type = "button";
    this.selectionIconBtnEl.textContent = "⚡";
    this.selectionIconBtnEl.setAttribute("aria-label", "Selection actions");

    this.templateMenuEl = document.createElement("div");
    this.templateMenuEl.className = "dama-selection-template-menu";
    this.renderTemplateMenu();

    this.selectionActionEl.append(this.selectionIconBtnEl, this.templateMenuEl);
    this.selectionActionEl.addEventListener("mouseenter", () => {
      this.openTemplateMenu();
    });
    this.selectionActionEl.addEventListener("mouseleave", () => {
      this.scheduleCloseTemplateMenu();
    });

    const inputRowEl = document.createElement("div");
    inputRowEl.className = "dama-floating-input-row";
    inputRowEl.append(this.inputEl);

    this.rootEl.append(this.contextEl, inputRowEl, this.thinkingEl, this.answerEl, this.errorEl);
    this.getMountRoot().appendChild(this.rootEl);
    this.getMountRoot().appendChild(this.selectionActionEl);

    this.applyMode();
    this.mounted = true;

    this.plugin.register(() => this.destroy());
  }

  destroy(): void {
    this.rootEl?.remove();
    this.selectionActionEl?.remove();
    this.rootEl = null;
    this.inputEl = null;
    this.errorEl = null;
    this.contextEl = null;
    this.thinkingEl = null;
    this.answerEl = null;
    this.selectionActionEl = null;
    this.selectionIconBtnEl = null;
    this.templateMenuEl = null;
    if (this.menuCloseTimer !== null) {
      window.clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
    this.mounted = false;
    this.clearHostClass();
    this.hostEl = null;
  }

  isVisible(): boolean {
    return Boolean(this.rootEl && !this.rootEl.classList.contains("dama-hidden"));
  }

  showDocked(): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.classList.remove("dama-hidden");
    this.rootEl.classList.add("dama-docked");
    this.rootEl.style.removeProperty("top");
  }

  hide(): void {
    this.rootEl?.classList.add("dama-hidden");
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  clearInput(): void {
    if (this.inputEl) {
      this.inputEl.value = "";
    }
  }

  setInputValue(value: string): void {
    if (this.inputEl) {
      this.inputEl.value = value;
    }
  }

  getInputValue(): string {
    return this.inputEl?.value ?? "";
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.rootEl) {
      this.rootEl.dataset.busy = busy ? "true" : "false";
    }
  }

  setError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
    }
  }

  setContextFile(path: string): void {
    if (!this.contextEl) {
      return;
    }
    this.contextEl.textContent = path ? `@${path}` : "";
  }

  clearStreamOutput(): void {
    if (this.thinkingEl) {
      this.thinkingEl.textContent = "";
      this.thinkingEl.classList.add("dama-hidden");
    }
    if (this.answerEl) {
      this.answerEl.textContent = "";
      this.answerEl.classList.add("dama-hidden");
    }
  }

  appendThinking(text: string): void {
    if (!this.thinkingEl || !text) {
      return;
    }
    this.thinkingEl.classList.remove("dama-hidden");
    this.thinkingEl.textContent = `${this.thinkingEl.textContent ?? ""}${text}`;
  }

  appendAnswer(text: string): void {
    if (!this.answerEl || !text) {
      return;
    }
    this.answerEl.classList.remove("dama-hidden");
    this.answerEl.textContent = `${this.answerEl.textContent ?? ""}${text}`;
  }

  setSelectionActive(active: boolean): void {
    this.selectionActive = active;
    if (this.rootEl) {
      this.rootEl.dataset.selectionActive = active ? "true" : "false";
    }
    if (this.selectionActionEl) {
      this.selectionActionEl.classList.toggle("dama-hidden", !active);
    }
  }

  setDockLayout(widthPx: number): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.style.width = `${widthPx}px`;
  }

  setHost(hostEl: HTMLElement | null): void {
    const nextHost = hostEl ?? null;
    if (this.hostEl === nextHost) {
      return;
    }

    this.clearHostClass();
    this.hostEl = nextHost;
    if (this.hostEl) {
      this.hostEl.classList.add("dama-floating-host");
    }

    if (!this.rootEl) {
      return;
    }

    this.getMountRoot().appendChild(this.rootEl);
    if (this.selectionActionEl) {
      this.getMountRoot().appendChild(this.selectionActionEl);
    }
  }

  setSelectionActionLayout(
    leftPx: number,
    topPx: number,
    menuLeftPx: number,
    menuWidthPx: number,
    placement: "left" | "right"
  ): void {
    if (!this.selectionActionEl) {
      return;
    }

    this.selectionActionEl.style.left = `${leftPx}px`;
    this.selectionActionEl.style.top = `${topPx}px`;
    this.selectionActionEl.style.setProperty("--dama-selection-menu-left", `${menuLeftPx - leftPx}px`);
    this.selectionActionEl.style.setProperty("--dama-selection-menu-width", `${menuWidthPx}px`);
    this.selectionActionEl.dataset.placement = placement;
  }

  updateOptions(options: FloatingBoxOptions): void {
    this.options = options;
    this.applyMode();
    this.renderTemplateMenu();
  }

  private applyMode(): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.dataset.mode = this.options.mode;
  }

  private renderTemplateMenu(): void {
    if (!this.templateMenuEl) {
      return;
    }

    this.templateMenuEl.textContent = "";
    if (this.options.templates.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "dama-template-empty";
      emptyEl.textContent = "No templates configured.";
      this.templateMenuEl.appendChild(emptyEl);
      return;
    }

    this.options.templates.forEach((template) => {
      const btn = document.createElement("button");
      btn.className = "dama-template-item";
      btn.type = "button";
      btn.textContent = template;
      btn.addEventListener("click", () => {
        void this.options.onTemplateFromSelection(template);
      });
      this.templateMenuEl?.appendChild(btn);
    });
  }

  private openTemplateMenu(): void {
    if (this.menuCloseTimer !== null) {
      window.clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
    this.selectionActionEl?.classList.add("dama-menu-open");
  }

  private scheduleCloseTemplateMenu(): void {
    if (this.menuCloseTimer !== null) {
      window.clearTimeout(this.menuCloseTimer);
    }
    this.menuCloseTimer = window.setTimeout(() => {
      this.selectionActionEl?.classList.remove("dama-menu-open");
      this.menuCloseTimer = null;
    }, 120);
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    const instruction = this.inputEl?.value.trim() ?? "";
    if (!instruction) {
      this.setError("Instruction is required.");
      return;
    }

    this.setError("");
    this.clearInput();
    this.focusInput();
    await this.options.onSubmit({ instruction });
  }

  private getMountRoot(): HTMLElement {
    return this.hostEl ?? document.body;
  }

  private clearHostClass(): void {
    this.hostEl?.classList.remove("dama-floating-host");
  }
}
