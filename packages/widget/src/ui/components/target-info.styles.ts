import * as stylex from "@stylexjs/stylex";

import { colors, fonts, radii } from "../../styles/tokens.stylex";

export const targetInfoStyles = stylex.create({
  label: {
    position: "fixed",
    zIndex: 3,
    display: "flex",
    maxWidth: "min(640px, calc(100vw - 16px))",
    padding: "4px 7px",
    alignItems: "baseline",
    gap: 8,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.label,
    boxShadow: colors.shadow,
    pointerEvents: "none",
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 1.4,
    whiteSpace: "nowrap",
  },
  name: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  detail: {
    minWidth: 0,
    flexShrink: 2,
    overflow: "hidden",
    color: colors.mutedForeground,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 1.4,
    textOverflow: "ellipsis",
  },
});
