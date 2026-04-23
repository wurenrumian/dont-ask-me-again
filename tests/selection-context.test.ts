import { describe, expect, it } from "vitest";

import { buildSelectionAlias } from "../src/selection-context";

describe("buildSelectionAlias", () => {
  it("uses the selected text as the wikilink alias", () => {
    expect(buildSelectionAlias("What is entropy?")).toBe("What is entropy?");
  });

  it("trims surrounding whitespace", () => {
    expect(buildSelectionAlias("  entropy  ")).toBe("entropy");
  });
});
