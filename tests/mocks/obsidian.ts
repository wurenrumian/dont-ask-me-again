export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl mock is not implemented in this test.");
}

export function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

export class App {}
export class Editor {}
export class TFile {}
export class Plugin {}
export class Menu {}
export class Modal {
  contentEl = {
    empty() {},
    createEl() {
      return {
        style: {},
        createDiv() {
          return { style: {}, createEl() {}, createDiv() {} };
        }
      };
    }
  };
  setTitle() {}
  open() {}
  close() {}
}
export class MarkdownView {}
export class Notice {}
export class PluginSettingTab {}
export class Setting {
  settingEl = { addClass() {}, remove() {} };
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  addTextArea() { return this; }
}
export class FuzzySuggestModal<T> {
  constructor(_app: App) {}
  setPlaceholder() {}
  open() {}
}
