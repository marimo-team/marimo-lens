import { useEffect, useState } from "react";

type LensTheme = "dark" | "light";

type MarimoMountConfig = {
  appConfig?: {
    display?: {
      theme?: string;
    };
  };
  config?: {
    display?: {
      theme?: string;
    };
  };
  configOverrides?: {
    display?: {
      theme?: string;
    };
  };
};

type MarimoWindow = Window & {
  __MARIMO_MOUNT_CONFIG__?: MarimoMountConfig;
};

const DARK_QUERY = "(prefers-color-scheme: dark)";
const THEME_ATTRIBUTES = [
  "data-theme",
  "data-color-mode",
  "data-marimo-theme",
  "data-mode",
] as const;

export function useLensTheme(): LensTheme {
  const [theme, setTheme] = useState<LensTheme>(() => detectLensTheme());

  useEffect(() => {
    const update = () => setTheme(detectLensTheme());
    const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    media?.addEventListener("change", update);

    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    if (observer) {
      observer.observe(document.documentElement, {
        attributeFilter: [...THEME_ATTRIBUTES, "class", "style"],
        attributes: true,
      });
      if (document.body) {
        observer.observe(document.body, {
          attributeFilter: [...THEME_ATTRIBUTES, "class", "style"],
          attributes: true,
        });
      }
    }

    return () => {
      media?.removeEventListener("change", update);
      observer?.disconnect();
    };
  }, []);

  return theme;
}

function detectLensTheme(): LensTheme {
  return themeFromDocument() ?? themeFromMarimoConfig() ?? themeFromSystem();
}

function themeFromMarimoConfig(): LensTheme | null {
  if (typeof window === "undefined") return null;
  const config = (window as MarimoWindow).__MARIMO_MOUNT_CONFIG__;
  return (
    themeFromValue(config?.configOverrides?.display?.theme) ??
    themeFromValue(config?.appConfig?.display?.theme) ??
    themeFromValue(config?.config?.display?.theme)
  );
}

function themeFromDocument(): LensTheme | null {
  if (typeof document === "undefined") return null;
  const candidates = [document.documentElement, document.body].filter(
    (element): element is HTMLElement => element !== null,
  );
  for (const element of candidates) {
    for (const attribute of THEME_ATTRIBUTES) {
      const theme = themeFromValue(element.getAttribute(attribute));
      if (theme) return theme;
    }
    const classTheme = themeFromClassList(element.classList);
    if (classTheme) return classTheme;
  }
  return null;
}

function themeFromClassList(classList: DOMTokenList): LensTheme | null {
  if (classList.contains("dark")) return "dark";
  if (classList.contains("light")) return "light";
  return null;
}

function themeFromValue(value: string | null | undefined): LensTheme | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "system" || normalized === "auto") return null;
  if (normalized.includes("dark")) return "dark";
  if (normalized.includes("light")) return "light";
  return null;
}

function themeFromSystem(): LensTheme {
  if (typeof window === "undefined") return "dark";
  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}
