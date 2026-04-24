import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";

import {
  deleteModelProvider,
  listModelProviders,
  saveModelProvider,
  type ModelProviderEntry,
  type ModelProviderSaveRequest,
  type ProviderName
} from "./api-client";
import type DontAskMeAgainPlugin from "./main";

export type SelectionUiMode = "templates-first" | "input-first";
export type ApiFormatMode = "dama-native" | "openai-responses";

export interface DontAskMeAgainSettings {
  serverBaseUrl: string;
  autoStartServer: boolean;
  showServerTerminalOnAutoStart: boolean;
  serverStartupCommand: string;
  serverStartupCwd: string;
  titleGenerationModelId: string | null;
  defaultTemplates: string[];
  selectionUiMode: SelectionUiMode;
  apiFormatMode: ApiFormatMode;
  showStatusBar: boolean;
  floatingBoxDefaultPosition: "bottom-docked";
  openResultInCurrentTab: boolean;
}

export const DEFAULT_SETTINGS: DontAskMeAgainSettings = {
  serverBaseUrl: "http://127.0.0.1:8787",
  autoStartServer: true,
  showServerTerminalOnAutoStart: false,
  serverStartupCommand:
    "server\\.venv\\Scripts\\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787",
  serverStartupCwd: "",
  titleGenerationModelId: null,
  defaultTemplates: [
    "Explain this in detail.",
    "Give me a concrete example.",
    "Explain this like I am five."
  ],
  selectionUiMode: "templates-first",
  apiFormatMode: "dama-native",
  showStatusBar: true,
  floatingBoxDefaultPosition: "bottom-docked",
  openResultInCurrentTab: true
};

// UI State
interface ModelProviderFormState {
  isEditing: boolean;
  editingId: string | null;
  provider: ProviderName;
  model: string;
  apiBase: string;
  apiKey: string;
  label: string;
  isDefault: boolean;
}

const ALL_PROVIDER_OPTIONS: { value: ProviderName; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" }
];

export class DontAskMeAgainSettingTab extends PluginSettingTab {
  private modelProviders: ModelProviderEntry[] = [];
  private formState: ModelProviderFormState = this.getInitialFormState();
  private isLoading = false;

  constructor(app: App, private readonly plugin: DontAskMeAgainPlugin) {
    super(app, plugin);
  }

  private getInitialFormState(): ModelProviderFormState {
    return {
      isEditing: false,
      editingId: null,
      provider: "openai",
      model: "",
      apiBase: "",
      apiKey: "",
      label: "",
      isDefault: false
    };
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    this.renderServerSettings(containerEl);
    this.renderModelProviderSection(containerEl);
    this.renderTemplatesSection(containerEl);
    this.renderMiscSettings(containerEl);
  }

  private renderServerSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Server base URL")
      .setDesc("Tool server base URL used for session-aware AI calls.")
      .addText((text) => {
        text
          .setPlaceholder("http://127.0.0.1:8787")
          .setValue(this.plugin.settings.serverBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverBaseUrl = value.trim();
            await this.plugin.saveSettings();
          });
        this.configureHardenedInput(text.inputEl);
      });

    new Setting(containerEl)
      .setName("Auto-start local server")
      .setDesc("On plugin load, auto start local server when health check is unreachable.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStartServer).onChange(async (value) => {
          this.plugin.settings.autoStartServer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show terminal when auto-starting")
      .setDesc("Enable for development diagnostics. Keep disabled for daily use.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showServerTerminalOnAutoStart)
          .onChange(async (value) => {
            this.plugin.settings.showServerTerminalOnAutoStart = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Server startup command")
      .setDesc("Executed when auto-start is triggered.")
      .addText((text) =>
        text.setValue(this.plugin.settings.serverStartupCommand).onChange(async (value) => {
          this.plugin.settings.serverStartupCommand = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Start local server now")
      .setDesc("Manually trigger the same auto-start logic.")
      .addButton((button) =>
        button.setButtonText("Start").setCta().onClick(async () => {
          const ok = await this.plugin.ensureServerRunning(true, { allowAutoStart: true });
          new Notice(ok ? "Local server is ready." : "Local server start failed.");
        })
      );

    new Setting(containerEl)
      .setName("API format")
      .setDesc("Choose request format: DAMA native stream or OpenAI Responses.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("dama-native", "DAMA native (/api/v1/chat/stream)")
          .addOption("openai-responses", "OpenAI Responses (/v1/responses)")
          .setValue(this.plugin.settings.apiFormatMode)
          .onChange(async (value) => {
            this.plugin.settings.apiFormatMode = value as ApiFormatMode;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderModelProviderSection(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "model-provider-section" });

    const headerEl = sectionEl.createDiv({ cls: "model-provider-header" });
    headerEl.createEl("h3", { text: "Model Providers" });

    const actionsEl = headerEl.createDiv({ cls: "model-provider-header-actions" });

    actionsEl.createEl("button", { text: "Refresh", cls: "mod-subtle" }, (btn) => {
      btn.onclick = async () => {
        await this.loadModelProviders(sectionEl);
      };
    });

    actionsEl.createEl("button", { text: "+ Add Model", cls: "mod-cta" }, (btn) => {
      btn.onclick = async () => {
        const serverReady = await this.ensureServerReadyOrNotice(
          "Server unavailable. Start local server first, then add model."
        );
        if (!serverReady) {
          return;
        }
        this.startAddingNew();
      };
    });

    sectionEl.createEl("p", {
      text: "Configure your AI models and providers. Click a card to set default, use buttons to edit or delete.",
      cls: "model-provider-desc"
    });

    this.renderTitleGenerationModelSetting(sectionEl);

    // 加载现有配置
    this.loadModelProviders(sectionEl);
  }

  private renderTitleGenerationModelSetting(containerEl: HTMLElement): void {
    containerEl.querySelector(".title-generation-model-setting")?.remove();

    const setting = new Setting(containerEl)
      .setName("Title generation model")
      .setDesc("Choose a configured model for automatic session titles, or disable title generation.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Disabled");
        for (const entry of this.modelProviders) {
          dropdown.addOption(entry.id, entry.label || entry.model);
        }
        dropdown.setValue(this.plugin.settings.titleGenerationModelId ?? "");
        dropdown.onChange(async (value) => {
          this.plugin.settings.titleGenerationModelId = value || null;
          await this.plugin.saveSettings();
        });
      });

    setting.settingEl.addClass("title-generation-model-setting");
  }

  private configureHardenedInput(inputEl: HTMLInputElement): void {
    inputEl.autocomplete = "off";
    inputEl.spellcheck = false;
    inputEl.setAttribute("autocapitalize", "off");
    inputEl.setAttribute("autocorrect", "off");
    inputEl.setAttribute("data-lpignore", "true");
  }

  private async ensureServerReadyOrNotice(
    unavailableNotice: string,
    options?: { allowAutoStart?: boolean }
  ): Promise<boolean> {
    const ready = await this.plugin.ensureServerRunning(false, options);
    if (!ready) {
      new Notice(unavailableNotice);
      return false;
    }
    return true;
  }

  private async loadModelProviders(containerEl: HTMLElement): Promise<void> {
    this.isLoading = true;

    try {
      const serverReady = await this.plugin.ensureServerRunning();
      if (!serverReady) {
        this.renderServerWarning(containerEl);
        return;
      }

      const response = await listModelProviders(this.plugin.settings.serverBaseUrl);
      if (!response.ok) {
        new Notice("Failed to load model providers");
        return;
      }

      this.modelProviders = response.entries;
      this.renderTitleGenerationModelSetting(containerEl);
      this.renderModelProviderList(containerEl);
    } catch (error) {
      new Notice("Failed to load model providers");
      console.error(error);
    } finally {
      this.isLoading = false;
    }
  }

  private renderServerWarning(containerEl: HTMLElement): void {
    containerEl.querySelector(".model-provider-cards")?.remove();
    containerEl.querySelector(".model-provider-warning")?.remove();

    containerEl.createEl("div", {
      cls: "model-provider-warning",
      text: "⚠️ Server is not running. Start the server to manage model providers."
    });
  }

  private renderModelProviderList(containerEl: HTMLElement): void {
    containerEl.querySelector(".model-provider-warning")?.remove();

    // 清理旧的卡片区域
    const existingCards = containerEl.querySelector(".model-provider-cards");
    if (existingCards) {
      existingCards.remove();
    }

    const cardsContainer = containerEl.createDiv({ cls: "model-provider-cards" });

    if (this.modelProviders.length === 0) {
      cardsContainer.createEl("div", {
        cls: "model-provider-empty",
        text: "No model providers configured. Add one above."
      });
    } else {
      for (const entry of this.modelProviders) {
        this.renderModelProviderCard(cardsContainer, entry);
      }
    }
  }

  private renderModelProviderCard(container: HTMLElement, entry: ModelProviderEntry): void {
    const card = container.createDiv({
      cls: `model-provider-card ${entry.is_default ? "is-default" : ""}`
    });

    card.onclick = () => {
      void this.setDefaultModelProvider(entry);
    };

    // Header row: provider badge + model name
    const header = card.createDiv({ cls: "mp-card-header" });

    header.createSpan({ cls: "mp-provider-badge", text: entry.provider.toUpperCase() });

    if (entry.is_default) {
      header.createSpan({ cls: "mp-default-badge", text: "DEFAULT" });
    }

    header.createDiv({ cls: "mp-card-title", text: entry.label || entry.model });

    // Model detail
    const detail = card.createDiv({ cls: "mp-card-detail" });
    if (entry.api_base) {
      detail.setText(`${entry.model} @ ${entry.api_base}`);
    } else {
      detail.setText(entry.model);
    }

    // API key status
    if (entry.api_key_env) {
      card.createDiv({
        cls: "mp-card-key-status",
        text: `API key: ${entry.api_key_env}`
      });
    }

    // Action buttons
    const actions = card.createDiv({ cls: "mp-card-actions" });

    const editBtn = actions.createEl("button", { text: "Edit" });
    editBtn.onclick = (e) => {
      e.stopPropagation();
      this.startEditing(entry);
    };

    const deleteBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.confirmDelete(entry);
    };
  }

  private startEditing(entry: ModelProviderEntry): void {
    this.formState = {
      isEditing: true,
      editingId: entry.id,
      provider: entry.provider,
      model: entry.model,
      apiBase: entry.api_base || "",
      apiKey: "",  // 不回填 API key
      label: entry.label || "",
      isDefault: entry.is_default
    };
    this.showFormModal(entry);
  }

  private startAddingNew(): void {
    this.formState = this.getInitialFormState();
    this.formState.isEditing = false;
    this.showFormModal(null);
  }

  private showFormModal(existingEntry: ModelProviderEntry | null): void {
    const modal = new Modal(this.app);
    modal.setTitle(existingEntry ? "Edit Model Provider" : "Add Model Provider");
    modal.contentEl.empty();

    const form = modal.contentEl.createEl("form");

    // Provider
    new Setting(form)
      .setName("Provider")
      .setDesc("AI provider name")
      .addDropdown((dropdown) => {
        for (const opt of ALL_PROVIDER_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        dropdown.setValue(this.formState.provider);
        dropdown.onChange((value) => {
          this.formState.provider = value as ProviderName;
        });
      });

    // Label
    new Setting(form)
      .setName("Label (optional)")
      .setDesc("A friendly name for this configuration")
      .addText((text) => {
        text.setValue(this.formState.label);
        text.setPlaceholder("e.g., My GPT-4 Config");
        text.onChange((value) => {
          this.formState.label = value.trim();
        });
      });

    // Model
    new Setting(form)
      .setName("Model")
      .setDesc("Provider model name")
      .addText((text) => {
        text.setValue(this.formState.model);
        text.setPlaceholder("e.g., gpt-4.1, claude-sonnet-4.5");
        text.onChange((value) => {
          this.formState.model = value.trim();
        });
      });

    // API Base
    new Setting(form)
      .setName("API Base URL (optional)")
      .setDesc("Custom endpoint for compatible gateways")
      .addText((text) => {
        text.setValue(this.formState.apiBase);
        text.setPlaceholder("e.g., https://api.openai.com/v1");
        text.onChange((value) => {
          this.formState.apiBase = value.trim();
        });
      });

    // API Key
    new Setting(form)
      .setName("API Key (optional)")
      .setDesc(existingEntry ? "Leave empty to keep existing key" : "API key for authentication")
      .addText((text) => {
        text.setValue(this.formState.apiKey);
        text.setPlaceholder(existingEntry ? "(unchanged)" : "sk-...");
        text.inputEl.type = "password";
        this.configureHardenedInput(text.inputEl);
        text.inputEl.autocomplete = "new-password";
        text.onChange((value) => {
          this.formState.apiKey = value.trim();
        });
      });

    // Default toggle
    new Setting(form)
      .setName("Set as default")
      .setDesc("Use this as the default model provider")
      .addToggle((toggle) => {
        toggle.setValue(this.formState.isDefault);
        toggle.onChange((value) => {
          this.formState.isDefault = value;
        });
      });

    const footer = form.createDiv({ cls: "dama-form-footer" });

    footer.createEl("button", { text: "Cancel" }, (btn) => {
      btn.type = "button";
      btn.onclick = () => modal.close();
    });

    footer.createEl("button", {
      text: existingEntry ? "Save Changes" : "Add Provider",
      cls: "mod-cta"
    }, (btn) => {
      btn.type = "submit";
    });

    form.onsubmit = async (e) => {
      e.preventDefault();

      if (!this.formState.model.trim()) {
        new Notice("Model name is required");
        return;
      }

      const payload: ModelProviderSaveRequest = {
        id: this.formState.editingId,
        provider: this.formState.provider,
        model: this.formState.model.trim(),
        api_base: this.formState.apiBase.trim() || null,
        api_key: this.formState.apiKey || null,
        label: this.formState.label || null,
        is_default: this.formState.isDefault
      };

      try {
        const serverReady = await this.ensureServerReadyOrNotice(
          "Server unavailable. Please start local server first."
        );
        if (!serverReady) {
          return;
        }

        const response = await saveModelProvider(this.plugin.settings.serverBaseUrl, payload);

        if (!response.ok) {
          new Notice(`Failed to save: ${(response as any).error?.message || "Unknown error"}`);
          return;
        }

        new Notice(existingEntry ? "Provider updated" : "Provider added");
        modal.close();
        this.display();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown save error";
        new Notice(`Save failed: ${message}`);
      }
    };

    modal.open();
  }

  private async setDefaultModelProvider(entry: ModelProviderEntry): Promise<void> {
    if (entry.is_default || this.isLoading) {
      return;
    }

    try {
      const serverReady = await this.ensureServerReadyOrNotice(
        "Server unavailable. Please start local server first."
      );
      if (!serverReady) {
        return;
      }

      const payload: ModelProviderSaveRequest = {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        api_base: entry.api_base ?? null,
        api_key: null,
        label: entry.label ?? null,
        is_default: true
      };
      const response = await saveModelProvider(this.plugin.settings.serverBaseUrl, payload);
      if (!response.ok) {
        new Notice(`Failed to set default: ${(response as any).error?.message || "Unknown error"}`);
        return;
      }

      new Notice(`Default model set: ${entry.label || entry.model}`);
      await this.display();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Failed to set default: ${message}`);
    }
  }

  private confirmDelete(entry: ModelProviderEntry): void {
    const confirmed = window.confirm(
      `Delete "${entry.label || entry.model}" (${entry.provider})?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    this.deleteEntry(entry.id);
  }

  private async deleteEntry(id: string): Promise<void> {
    try {
      const serverReady = await this.ensureServerReadyOrNotice(
        "Server unavailable. Please start local server first."
      );
      if (!serverReady) {
        return;
      }

      const response = await deleteModelProvider(this.plugin.settings.serverBaseUrl, id);

      if (!response.ok) {
        new Notice("Failed to delete provider");
        return;
      }

      new Notice("Provider deleted");
      this.display();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Delete failed: ${message}`);
    }
  }

  private renderTemplatesSection(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Templates" });

    const templateSetting = new Setting(containerEl)
      .setName("Selection templates")
      .setDesc("One template per line for the selection popup.")
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.defaultTemplates.join("\n"));
        text.inputEl.addClass("dama-settings-template-input");
        text.inputEl.rows = 10;
        text.onChange(async (value) => {
          this.plugin.settings.defaultTemplates = value
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        });
      });
    templateSetting.settingEl.addClass("dama-settings-template-setting");

    new Setting(containerEl)
      .setName("Selection UI mode")
      .setDesc("For compatibility only. Templates are now exposed via command and editor menu.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("templates-first", "Templates first")
          .addOption("input-first", "Input first")
          .setValue(this.plugin.settings.selectionUiMode)
          .onChange(async (value) => {
            this.plugin.settings.selectionUiMode = value as SelectionUiMode;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderMiscSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Miscellaneous" });

    new Setting(containerEl)
      .setName("Show status bar")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
          this.plugin.settings.showStatusBar = value;
          await this.plugin.saveSettings();
          this.plugin.refreshStatusBar();
        })
      );

    new Setting(containerEl)
      .setName("Open result in current tab")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openResultInCurrentTab)
          .onChange(async (value) => {
            this.plugin.settings.openResultInCurrentTab = value;
            await this.plugin.saveSettings();
          })
      );

  }

}
