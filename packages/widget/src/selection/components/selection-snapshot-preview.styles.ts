import * as stylex from "@stylexjs/stylex";

import { colors, fonts, media, motion, radii } from "../../styles/tokens.stylex";

export const snapshotStyles = stylex.create({
  trigger: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: 500,
  },
  triggerFailed: {
    color: colors.destructive,
  },
  triggerIcon: {
    justifyContent: "center",
  },
  triggerButton: {
    minHeight: { default: 28, [media.coarsePointer]: 44 },
    padding: "0 7px",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
  },
  preview: {
    position: "fixed",
    zIndex: 14,
    display: "block",
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100dvh - 24px)",
    margin: 0,
    padding: 0,
    overflow: "hidden",
    pointerEvents: "auto",
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.border, [media.forcedColors]: "Highlight" },
    borderRadius: radii.surface,
    boxShadow: colors.shadow,
    transitionProperty: "opacity, transform",
    transitionDuration: { default: "160ms", [media.reducedMotion]: "120ms" },
    transitionTimingFunction: { default: motion.easeOut, [media.reducedMotion]: "linear" },
    transform: { [media.reducedMotion]: "none" },
  },
  animated: {
    opacity: { default: 1, "@starting-style": 0 },
    transform: {
      default: null,
      "@starting-style": "translateY(3px) scale(0.98)",
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
    minHeight: 44,
    padding: "5px 6px 5px 11px",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  heading: {
    display: "grid",
    gap: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
  },
  metadata: {
    color: colors.mutedForeground,
    fontFamily: fonts.mono,
    fontSize: 9,
  },
  image: {
    display: "grid",
    minHeight: 96,
    maxHeight: "min(420px, calc(100dvh - 140px))",
    placeItems: "center",
    overflow: "auto",
    backgroundColor: colors.surfaceSubtle,
  },
  bitmap: {
    display: "block",
    width: "auto",
    maxWidth: "100%",
    height: "auto",
    maxHeight: "min(420px, calc(100dvh - 140px))",
    objectFit: "contain",
  },
  imageStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: colors.mutedForeground,
    fontSize: 11,
  },
  imageError: {
    color: colors.destructive,
  },
  caption: {
    display: "grid",
    gap: 2,
    padding: "8px 10px",
    color: colors.mutedForeground,
    fontSize: 10,
  },
  captionWarning: {
    color: colors.foreground,
    fontWeight: 600,
  },
});
