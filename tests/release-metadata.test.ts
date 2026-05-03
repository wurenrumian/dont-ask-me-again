import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

interface PackageJson {
  version?: string;
}

interface ManifestJson {
  version?: string;
  minAppVersion?: string;
}

describe("release metadata", () => {
  test("keeps package, manifest, and versions.json aligned for BRAT releases", () => {
    const root = path.resolve(__dirname, "..");
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    ) as PackageJson;
    const manifestJson = JSON.parse(
      readFileSync(path.join(root, "manifest.json"), "utf-8")
    ) as ManifestJson;
    const versionsJson = JSON.parse(
      readFileSync(path.join(root, "versions.json"), "utf-8")
    ) as Record<string, string>;

    expect(packageJson.version).toBe("0.1.0-beta.1");
    expect(manifestJson.version).toBe(packageJson.version);
    expect(versionsJson[packageJson.version ?? ""]).toBe(manifestJson.minAppVersion);
  });
});
