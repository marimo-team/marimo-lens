import { expect, test } from "vite-plus/test";

import { observeLensTheme, type LensTheme } from "@/ui/theme";

test("reports resolved theme changes and releases its document observer", async () => {
  const themes: LensTheme[] = [];
  const release = observeLensTheme(document, (theme) => themes.push(theme));
  try {
    expect(themes).toEqual(["light"]);
    document.body.classList.add("dragging");
    await Promise.resolve();
    expect(themes).toEqual(["light"]);
    document.documentElement.dataset.theme = "dark";
    await Promise.resolve();
    expect(themes).toEqual(["light", "dark"]);
    document.body.classList.add("dark");
    await Promise.resolve();
    expect(themes).toEqual(["light", "dark"]);
    release();
    document.documentElement.dataset.theme = "light";
    document.body.className = "";
    await Promise.resolve();
    expect(themes).toEqual(["light", "dark"]);
  } finally {
    release();
    delete document.documentElement.dataset.theme;
    document.body.className = "";
  }
});
