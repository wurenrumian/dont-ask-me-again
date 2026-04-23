import type { Plugin } from "obsidian";

import type { SelectionUiMode } from "./settings";

export interface FloatingSubmitPayload {
  instruction: string;
}

export interface FloatingBoxOptions {
  templates: string[];
  mode: SelectionUiMode;
  onSubmit: (payload: FloatingSubmitPayload) => Promise<void>;
  onQuoteSelection: () => void;
}

export class FloatingBox {
  private rootEl: HTMLDivElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private contextEl: HTMLDivElement | null = null;
  private thinkingEl: HTMLPreElement | null = null;
  private answerEl: HTMLPreElement | null = null;
  private quoteBtnEl: HTMLButtonElement | null = null;
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

    this.quoteBtnEl = document.createElement("button");
    this.quoteBtnEl.className = "dama-quote-btn dama-hidden";
    this.quoteBtnEl.type = "button";
    this.quoteBtnEl.textContent = "Quote Selection";
    this.quoteBtnEl.addEventListener("click", () => {
      this.options.onQuoteSelection();
    });

    const inputRowEl = document.createElement("div");
    inputRowEl.className = "dama-floating-input-row";
    inputRowEl.append(this.inputEl);

    this.rootEl.append(this.contextEl, inputRowEl, this.thinkingEl, this.answerEl, this.errorEl);
    document.body.appendChild(this.rootEl);
    document.body.appendChild(this.quoteBtnEl);

    this.applyMode();
    this.mounted = true;

    this.plugin.register(() => this.destroy());
  }

  destroy(): void {
    this.rootEl?.remove();
    this.quoteBtnEl?.remove();
    this.rootEl = null;
    this.inputEl = null;
    this.errorEl = null;
    this.contextEl = null;
    this.thinkingEl = null;
    this.answerEl = null;
    this.quoteBtnEl = null;
    this.mounted = false;
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
    if (this.quoteBtnEl) {
      this.quoteBtnEl.classList.toggle("dama-hidden", !active);
    }
  }

  setDockLayout(leftPx: number, widthPx: number): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.style.left = `${leftPx}px`;
    this.rootEl.style.width = `${widthPx}px`;
    this.rootEl.style.transform = "none";
  }

  setQuoteAnchor(leftPx: number, topPx: number): void {
    if (!this.quoteBtnEl) {
      return;
    }

    this.quoteBtnEl.style.left = `${leftPx}px`;
    this.quoteBtnEl.style.top = `${topPx}px`;
  }

  updateOptions(options: FloatingBoxOptions): void {
    this.options = options;
    this.applyMode();
  }

  private applyMode(): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.dataset.mode = this.options.mode;
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
}
