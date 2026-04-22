import { App, PluginSettingTab, Setting } from "obsidian";

import type DontAskMeAgainPlugin from "./main";

export type SelectionUiMode = "templates-first" | "input-first";

export interface DontAskMeAgainSettings {
  serverBaseUrl: string;
  defaultTemplates: string[];
  selectionUiMode: SelectionUiMode;
  showStatusBar: boolean;
  floatingBoxDefaultPosition: "bottom-docked";
  openResultInCurrentTab: boolean;
}

export const DEFAULT_SETTINGS: DontAskMeAgainSettings = {
  serverBaseUrl: "http://127.0.0.1:8787",
  defaultTemplates: [
    "Explain this in detail.",
    "Give me a concrete example.",
    "Explain this like I am five."
  ],
  selectionUiMode: "templates-first",
  showStatusBar: true,
  floatingBoxDefaultPosition: "bottom-docked",
  openResultInCurrentTab: true
};

export class DontAskMeAgainSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DontAskMeAgainPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Server base URL")
      .setDesc("Tool server base URL used for session-aware AI calls.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8787")
          .setValue(this.plugin.settings.serverBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Templates")
      .setDesc("One template per line for the selection popup.")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.defaultTemplates.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.defaultTemplates = value
              .split("\n")
              .map((entry) => entry.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Selection UI mode")
      .setDesc("Choose whether templates or freeform input gets priority when text is selected.")
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
