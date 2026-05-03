import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({
  requestUrlMock: vi.fn()
}));

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("./mocks/obsidian")>("obsidian");
  return {
    ...actual,
    requestUrl: requestUrlMock,
    Notice: class Notice {
      constructor(_message: string) {}
    }
  };
});

import { LocalServerManager } from "../src/local-server-manager";

describe("LocalServerManager", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
    requestUrlMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ json: { status: "ok" } });
  });

  it("uses cmd.exe /k when showing the server terminal on Windows", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      value: "win32"
    });
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const requireMock = vi.fn((id: string) => {
      if (id === "child_process") {
        return { spawn };
      }
      if (id === "path") {
        return { join: (...parts: string[]) => parts.join("\\") };
      }
      throw new Error(`unexpected require: ${id}`);
    });

    vi.stubGlobal("window", {
      require: requireMock,
      setTimeout: (cb: () => void) => {
        cb();
        return 1;
      }
    });

    try {
      const manager = new LocalServerManager({
        app: {
          vault: {
            adapter: {
              getBasePath: () => "D:\\Distiller"
            }
          }
        } as any,
        manifestId: "dont-ask-me-again",
        getSettings: () => ({
          serverBaseUrl: "http://127.0.0.1:8787",
          autoStartServer: true,
          showServerTerminalOnAutoStart: true,
          serverStartupCommand: "server\\.venv\\Scripts\\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787",
          serverStartupCwd: "",
          titleGenerationModelId: null,
          imageGenerationModelId: null,
          maxImagesPerRequest: 1,
          imageGenerationSize: "auto",
          imageGenerationQuality: "auto",
          imageGenerationOutputFormat: "png",
          defaultTemplates: [],
          selectionUiMode: "templates-first",
          apiFormatMode: "dama-native",
          showStatusBar: true,
          floatingBoxDefaultPosition: "bottom-docked",
          openResultInCurrentTab: true,
          verbosityLevel: 2
        })
      });

      const ok = await manager.ensureServerRunning(false, { allowAutoStart: true });

      expect(ok).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "cmd.exe",
        [
          "/k",
          "server\\.venv\\Scripts\\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787"
        ],
        expect.objectContaining({
          cwd: "D:\\Distiller\\.obsidian\\plugins\\dont-ask-me-again",
          shell: false,
          detached: false,
          stdio: "ignore",
          windowsHide: false
        })
      );
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });
});
