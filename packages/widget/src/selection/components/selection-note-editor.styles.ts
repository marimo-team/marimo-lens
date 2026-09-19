import * as stylex from "@stylexjs/stylex";

import { colors, media, motion, radii } from "../../styles/tokens.stylex";

export const noteEditorStyles = stylex.create({
  editor: {
    position: "fixed",
    zIndex: 12,
    top: { [media.mobile]: "auto !important" },
    right: { [media.mobile]: "12px !important" },
    bottom: {
      [media.mobile]: "max(64px, calc(env(safe-area-inset-bottom) + 56px)) !important",
    },
    left: { [media.mobile]: "12px !important" },
    width: { default: "min(320px, calc(100vw - 24px))", [media.mobile]: "auto !important" },
    maxHeight: { default: "calc(100dvh - 24px)", [media.mobile]: "min(70dvh, 520px)" },
    margin: 0,
    padding: 10,
    overflow: "auto",
    pointerEvents: "auto",
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.surface,
    boxShadow: colors.shadow,
    transitionProperty: "opacity, transform",
    transitionDuration: { default: "170ms", [media.reducedMotion]: "120ms" },
    transitionTimingFunction: { default: motion.easeOut, [media.reducedMotion]: "linear" },
    transform: { [media.reducedMotion]: "none" },
    transformOrigin: { [media.mobile]: "center bottom" },
    "::backdrop": {
      backgroundColor: "rgb(15 23 42 / 10%)",
    },
  },
  animated: {
    opacity: { default: 1, "@starting-style": 0 },
    transform: {
      default: null,
      "@starting-style": "translateY(4px) scale(0.98)",
      [media.reducedMotion]: "none",
    },
  },
  instant: {
    transitionProperty: "none",
  },
  above: {
    transformOrigin: "center bottom",
  },
  below: {
    transformOrigin: "center top",
  },
  header: {
    display: "flex",
    minWidth: 0,
    marginBottom: 8,
    overflow: "hidden",
    alignItems: "center",
    gap: 5,
    color: colors.mutedForeground,
    fontSize: 11,
    lineHeight: 1.3,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selection: {
    color: colors.foreground,
    fontWeight: 600,
  },
  target: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  input: {
    display: "block",
    width: "100%",
    minHeight: 82,
    maxHeight: 220,
    resize: "none",
    padding: "10px 11px",
    color: colors.foreground,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.label,
    font: "inherit",
    fontSize: 14,
    lineHeight: 1.45,
    outline: { ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: { ":focus-visible": 2 },
    "::placeholder": {
      color: colors.mutedForeground,
    },
  },
  error: {
    margin: "8px 0 0",
    color: colors.destructive,
    fontSize: 11,
  },
  footer: {
    display: "flex",
    minHeight: 32,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
});
