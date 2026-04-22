import type { Plugin } from "obsidian";

import type { SelectionUiMode } from "./settings";

export interface FloatingSubmitPayload {
  instruction: string;
}

export interface FloatingBoxOptions {
  templates: string[];
  mode: SelectionUiMode;
  onSubmit: (payload: FloatingSubmitPayload) => Promise<void>;
}

export class FloatingBox {
  private rootEl: HTMLDivElement | null = null;
  private templatesEl: HTMLDivElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private mounted = false;

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

    this.templatesEl = document.createElement("div");
    this.templatesEl.className = "dama-floating-templates";

    this.inputEl = document.createElement("textarea");
    this.inputEl.className = "dama-floating-input";
    this.inputEl.placeholder = "Ask the tool server...";
    this.inputEl.rows = 3;
    this.inputEl.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });

    this.submitButtonEl = document.createElement("button");
    this.submitButtonEl.className = "dama-floating-submit";
    this.submitButtonEl.textContent = "Send";
    this.submitButtonEl.addEventListener("click", () => {
      void this.submit();
    });

    this.errorEl = document.createElement("div");
    this.errorEl.className = "dama-floating-error";

    const inputRowEl = document.createElement("div");
    inputRowEl.className = "dama-floating-input-row";
    inputRowEl.append(this.inputEl, this.submitButtonEl);

    this.rootEl.append(this.templatesEl, inputRowEl, this.errorEl);
    document.body.appendChild(this.rootEl);

    this.renderTemplates();
    this.applyMode();
    this.mounted = true;

    this.plugin.register(() => this.destroy());
  }

  destroy(): void {
    this.rootEl?.remove();
    this.rootEl = null;
    this.templatesEl = null;
    this.inputEl = null;
    this.submitButtonEl = null;
    this.errorEl = null;
    this.mounted = false;
  }

  isVisible(): boolean {
    return Boolean(this.rootEl && !this.rootEl.classList.contains("dama-hidden"));
  }

  showDocked(): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.classList.remove("dama-hidden", "dama-near-selection");
    this.rootEl.classList.add("dama-docked");
    this.rootEl.style.removeProperty("left");
    this.rootEl.style.removeProperty("top");
  }

  showNear(rect: DOMRect): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.classList.remove("dama-hidden", "dama-docked");
    this.rootEl.classList.add("dama-near-selection");
    this.rootEl.style.left = `${Math.max(16, rect.left + window.scrollX)}px`;
    this.rootEl.style.top = `${Math.max(16, rect.bottom + window.scrollY + 12)}px`;
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
    if (!this.inputEl || !this.submitButtonEl || !this.templatesEl) {
      return;
    }

    this.inputEl.disabled = busy;
    this.submitButtonEl.disabled = busy;

    for (const button of Array.from(this.templatesEl.querySelectorAll("button"))) {
      button.disabled = busy;
    }
  }

  setError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
    }
  }

  updateOptions(options: FloatingBoxOptions): void {
    this.options = options;
    this.renderTemplates();
    this.applyMode();
  }

  private renderTemplates(): void {
    if (!this.templatesEl) {
      return;
    }

    this.templatesEl.replaceChildren();

    for (const template of this.options.templates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dama-template-button";
      button.textContent = template;
      button.addEventListener("click", () => {
        this.setInputValue(template);
        void this.submit();
      });
      this.templatesEl.appendChild(button);
    }
  }

  private applyMode(): void {
    if (!this.rootEl) {
      return;
    }

    this.rootEl.dataset.mode = this.options.mode;
  }

  private async submit(): Promise<void> {
    const instruction = this.inputEl?.value.trim() ?? "";
    if (!instruction) {
      this.setError("Instruction is required.");
      return;
    }

    this.setError("");
    await this.options.onSubmit({ instruction });
  }
}
