import * as stylex from "@stylexjs/stylex";

import { colors } from "../../styles/tokens.stylex";

export const kindMarkStyles = stylex.create({
  root: {
    display: "inline-flex",
    width: 14,
    height: 14,
    marginLeft: 2,
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "center",
    color: colors.primary,
  },
  push: {
    marginLeft: "auto",
  },
  svg: {
    display: "block",
    width: 14,
    height: 14,
    overflow: "visible",
  },
  outline: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1,
  },
  boundary: {
    opacity: 0.45,
  },
  solid: {
    fill: "currentColor",
  },
  regionFill: {
    fill: "currentColor",
    opacity: 0.1,
  },
});
