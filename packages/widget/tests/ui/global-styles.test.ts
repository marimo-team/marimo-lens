import { afterEach, describe, expect, test } from "vite-plus/test";

import { acquireLensGlobalStyles } from "@/ui/global-styles";

afterEach(() => {
  document.getElementById("marimo-lens-global-styles")?.remove();
});

describe("shared Lens styles", () => {
  test("remain mounted until the final view releases them", () => {
    const releaseFirst = acquireLensGlobalStyles(document, ".first {} ");
    const releaseSecond = acquireLensGlobalStyles(document, ".second {} ");

    releaseFirst();
    expect(document.getElementById("marimo-lens-global-styles")?.textContent).toBe(".second {} ");

    releaseSecond();
    expect(document.getElementById("marimo-lens-global-styles")).toBeNull();
  });

  test("keeps styles isolated to their owning documents", () => {
    const secondaryDocument = document.implementation.createHTMLDocument("secondary");
    const releasePrimary = acquireLensGlobalStyles(document, ".primary {} ");
    const releaseSecondary = acquireLensGlobalStyles(secondaryDocument, ".secondary {} ");

    expect(document.getElementById("marimo-lens-global-styles")?.textContent).toBe(".primary {} ");
    expect(secondaryDocument.getElementById("marimo-lens-global-styles")?.textContent).toBe(
      ".secondary {} ",
    );

    releasePrimary();
    expect(document.getElementById("marimo-lens-global-styles")).toBeNull();
    expect(secondaryDocument.getElementById("marimo-lens-global-styles")).not.toBeNull();
    releaseSecondary();
  });
});
