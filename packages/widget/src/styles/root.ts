import * as stylex from "@stylexjs/stylex";

import { colors, fonts } from "./tokens.stylex";

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
  error: {
    color: colors.destructive,
    fontFamily: fonts.sans,
    fontSize: "14px",
  },
});
