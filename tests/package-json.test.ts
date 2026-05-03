import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

describe("package.json scripts", () => {
  test("exposes setup script for Windows environment bootstrap", () => {
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.setup).toBe(
      "powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1"
    );
  });
});
