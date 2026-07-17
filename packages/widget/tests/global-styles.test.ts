import { afterEach, describe, expect, test } from "vite-plus/test";

import { acquireLensGlobalStyles } from "@/global-styles";

afterEach(() => {
  document.getElementById("marimo-lens-global-styles")?.remove();
});

describe("shared Lens styles", () => {
  test("remain mounted until the final view releases them", () => {
    const releaseFirst = acquireLensGlobalStyles(".first {} ");
    const releaseSecond = acquireLensGlobalStyles(".second {} ");

    releaseFirst();
    expect(document.getElementById("marimo-lens-global-styles")?.textContent).toBe(".second {} ");

    releaseSecond();
    expect(document.getElementById("marimo-lens-global-styles")).toBeNull();
  });
});
