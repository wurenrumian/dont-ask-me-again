import { describe, expect, it } from "vitest";

import { calculateSelectionMenuLayout } from "../src/selection-menu-layout";

describe("calculateSelectionMenuLayout", () => {
  it("prefers opening to the right when the anchor is on the left half", () => {
    expect(
      calculateSelectionMenuLayout({
        anchorLeft: 120,
        anchorTop: 80,
        hostWidth: 900
      })
    ).toMatchObject({
      actionLeft: 120,
      actionTop: 80,
      menuLeft: 120,
      menuWidth: 300,
      placement: "right"
    });
  });

  it("prefers opening to the left when the anchor is on the right half", () => {
    expect(
      calculateSelectionMenuLayout({
        anchorLeft: 720,
        anchorTop: 80,
        hostWidth: 900
      })
    ).toMatchObject({
      actionTop: 80,
      menuLeft: 420,
      menuWidth: 300,
      placement: "left"
    });
  });

  it("snaps to the right edge when the preferred right placement overflows", () => {
    expect(
      calculateSelectionMenuLayout({
        anchorLeft: 140,
        anchorTop: 80,
        hostWidth: 300
      })
    ).toMatchObject({
      menuLeft: 64,
      menuWidth: 220,
      placement: "right"
    });
  });

  it("snaps to the left edge when the preferred left placement overflows", () => {
    expect(
      calculateSelectionMenuLayout({
        anchorLeft: 140,
        anchorTop: 80,
        hostWidth: 240
      })
    ).toMatchObject({
      menuLeft: 16,
      menuWidth: 208,
      placement: "left"
    });
  });
});
