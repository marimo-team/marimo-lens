import * as stylex from "@stylexjs/stylex";

import { colors, fonts, media, motion, radii } from "./tokens.stylex";

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

export const ui = stylex.create({
  interactive: {
    margin: 0,
    borderWidth: 0,
    color: "inherit",
    font: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.48 },
    WebkitTapHighlightColor: "transparent",
    outline: { ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: { ":focus-visible": "2px" },
  },
  pressable: {
    transform: {
      default: null,
      ":not(:disabled):not([aria-disabled='true']):active": {
        default: "scale(0.97)",
        [media.reducedMotion]: "none",
      },
    },
  },
  control: {
    display: "inline-flex",
    minHeight: { default: 32, [media.coarsePointer]: 44 },
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: {
      default: "transparent",
      [media.hover]: { ":not(:disabled):not([aria-disabled='true']):hover": colors.hover },
    },
    borderRadius: radii.control,
    transitionProperty: "background-color, border-color, color, transform",
    transitionDuration: { default: "140ms", [media.reducedMotion]: "0ms" },
    transitionTimingFunction: motion.ease,
  },
  button: {
    padding: "0 10px",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  iconButton: {
    width: { default: 32, [media.coarsePointer]: 44 },
    padding: 0,
  },
  primary: {
    color: {
      default: colors.onPrimary,
      [media.hover]: { ":not(:disabled):not([aria-disabled='true']):hover": colors.onPrimary },
    },
    backgroundColor: {
      default: colors.primarySolid,
      [media.hover]: {
        ":not(:disabled):not([aria-disabled='true']):hover": `color-mix(in srgb, ${colors.primarySolid} 88%, black)`,
      },
    },
  },
  danger: {
    color: {
      default: colors.mutedForeground,
      ":focus-visible": colors.destructive,
      [media.hover]: { ":not(:disabled):not([aria-disabled='true']):hover": colors.destructive },
    },
    backgroundColor: {
      default: "transparent",
      [media.hover]: {
        ":not(:disabled):not([aria-disabled='true']):hover": colors.destructiveSoft,
      },
    },
  },
  label: {
    display: "inline-flex",
    minWidth: 30,
    height: 22,
    padding: "0 6px",
    alignItems: "center",
    justifyContent: "center",
    color: colors.foreground,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.label,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  borderless: {
    borderWidth: 0,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  visuallyHidden: {
    position: "fixed",
    width: 1,
    height: 1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  spin: {
    animationName: { default: spin, [media.reducedMotion]: "none" },
    animationDuration: "720ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

export const buttonStyles = [ui.interactive, ui.pressable, ui.control, ui.button] as const;
export const iconButtonStyles = [ui.interactive, ui.pressable, ui.control, ui.iconButton] as const;
