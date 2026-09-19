import * as stylex from "@stylexjs/stylex";

import { colors, fonts, radii } from "./tokens.stylex";

export const rootStyles = stylex.create({
  base: {
    all: "initial",
    color: colors.foreground,
    colorScheme: colors.colorScheme,
    fontFamily: fonts.sans,
    fontSize: "14px",
    lineHeight: 1.4,
  },
  portal: {
    position: "fixed",
    zIndex: 0,
    inset: 0,
    pointerEvents: "none",
  },
  conflict: {
    display: "flex",
    width: "fit-content",
    maxWidth: "100%",
    padding: "8px 10px",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "4px 8px",
    color: colors.mutedForeground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.control,
    fontSize: "12px",
  },
  conflictTitle: {
    color: colors.foreground,
    fontWeight: 600,
  },
  error: {
    color: colors.destructive,
    fontFamily: fonts.sans,
    fontSize: "14px",
  },
});
