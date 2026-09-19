import { createContext, useContext } from "react";

export type LensTheme = "light" | "dark";

export const LensThemeContext = createContext<LensTheme>("light");

export function useLensTheme(): LensTheme {
  return useContext(LensThemeContext);
}

const DARK_THEME =
  '.dark, .dark-mode, [data-theme="dark"], [data-mode="dark"], [data-vscode-theme-kind="vscode-dark"], [data-vscode-theme-kind="vscode-high-contrast"]';

export function observeLensTheme(ownerDocument: Document, onChange: (theme: LensTheme) => void) {
  const elements = [ownerDocument.documentElement, ownerDocument.body];
  let previous: LensTheme | undefined;
  const update = () => {
    const theme = elements.some((element) => element.matches(DARK_THEME)) ? "dark" : "light";
    if (theme === previous) return;
    previous = theme;
    onChange(theme);
  };
  const observer = new ownerDocument.defaultView!.MutationObserver(update);
  for (const element of elements) {
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-mode", "data-vscode-theme-kind"],
    });
  }
  update();
  return () => observer.disconnect();
}
