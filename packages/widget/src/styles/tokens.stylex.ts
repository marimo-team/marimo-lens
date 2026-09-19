import * as stylex from "@stylexjs/stylex";

const light = {
  surface: "var(--slate-1, #ffffff)",
  surfaceSubtle: "var(--slate-3, #f1f5f9)",
  foreground: "var(--slate-12, #0f172a)",
  mutedForeground: "var(--slate-11, #64748b)",
  border: "var(--slate-6, #e2e8f0)",
  primary: "#0880ea",
  primarySolid: "#0b68cb",
  accentForeground: "#095eb8",
  onPrimary: "#f8fafc",
  destructive: "var(--red-9, #ea5d5d)",
  destructiveSoft: "#fef2f2",
  focus: "#0880ea",
  hover: "color-mix(in srgb, var(--slate-12, #0f172a) 6%, transparent)",
  shadow: "0 2px 8px rgb(15 23 42 / 8%)",
  colorScheme: "light",
};

export const colors = stylex.defineVars(light);

export const lightTheme = stylex.createTheme(colors, light);

export const darkTheme = stylex.createTheme(colors, {
  ...light,
  surface: "var(--slate-1, #101412)",
  surfaceSubtle: "#181c1a",
  foreground: "var(--slate-12, #f1f5f3)",
  mutedForeground: "var(--slate-11, #aab2af)",
  border: "var(--slate-6, #3b403e)",
  accentForeground: "#8cc6ff",
  destructiveSoft: "#451f22",
  hover: "color-mix(in srgb, var(--slate-12, #f1f5f3) 6%, transparent)",
  shadow: "0 2px 8px rgb(0 0 0 / 24%)",
  colorScheme: "dark",
});

export const media = stylex.defineConsts({
  compact: "@media (max-width: 300px)",
  mobile: "@media (max-width: 640px)",
  hover: "@media (hover: hover) and (pointer: fine)",
  coarsePointer: "@media (pointer: coarse)",
  reducedMotion: "@media (prefers-reduced-motion: reduce)",
  forcedColors: "@media (forced-colors: active)",
});

export const radii = stylex.defineConsts({
  surface: "8px",
  control: "6px",
  label: "4px",
});

export const motion = stylex.defineConsts({
  ease: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
});

export const fonts = stylex.defineConsts({
  sans: '"PT Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Fira Mono", ui-monospace, monospace',
});
