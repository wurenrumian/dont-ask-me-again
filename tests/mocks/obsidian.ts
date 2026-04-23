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
export class MarkdownView {}
export class Notice {}
export class PluginSettingTab {}
export class Setting {}
