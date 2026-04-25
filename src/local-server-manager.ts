import { App, Notice, requestUrl } from "obsidian";

import type { DontAskMeAgainSettings } from "./settings";

interface LocalServerManagerOptions {
  app: App;
  manifestId: string;
  getSettings: () => DontAskMeAgainSettings;
}

export class LocalServerManager {
  private serverLaunchInFlight: Promise<boolean> | null = null;

  constructor(private readonly options: LocalServerManagerOptions) {}

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

  async checkServerHealth(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.options.getSettings().serverBaseUrl.replace(/\/$/, "")}/healthz`,
        method: "GET"
      });
      const json = response.json as { status?: string } | undefined;
      return json?.status === "ok";
    } catch {
      return false;
    }
  }

  private async launchAndWaitForServer(showNotice: boolean): Promise<boolean> {
    if (!(window as unknown as { require?: unknown }).require) {
      if (showNotice) {
        new Notice("Auto-start requires desktop Obsidian.");
      }
      return false;
    }

    const settings = this.options.getSettings();
    const command = settings.serverStartupCommand.trim();
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
      const showTerminal = settings.showServerTerminalOnAutoStart;
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

  private resolveServerStartupCwd(): string | undefined {
    const settings = this.options.getSettings();
    if (settings.serverStartupCwd.trim().length > 0) {
      return settings.serverStartupCwd.trim();
    }

    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    if (!req) {
      return undefined;
    }

    const adapter = this.options.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();
    if (!basePath) {
      return undefined;
    }

    const path = req("path") as { join: (...parts: string[]) => string };
    return path.join(basePath, ".obsidian", "plugins", this.options.manifestId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
}
