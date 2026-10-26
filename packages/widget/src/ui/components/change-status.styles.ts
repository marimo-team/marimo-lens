import * as stylex from "@stylexjs/stylex";

import { colors, media } from "../../styles/tokens.stylex";

export const changeStatusStyles = stylex.create({
  status: {
    display: "inline-flex",
    minWidth: 0,
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: "14px",
    whiteSpace: "nowrap",
  },
  in_force: {
    color: colors.mutedForeground,
  },
  undone: {
    color: colors.undone,
  },
  unknown: {
    color: colors.mutedForeground,
  },
  mark: {
    display: "inline-block",
    flexShrink: 0,
    width: 7,
    height: 7,
    boxSizing: "border-box",
    borderRadius: "50%",
  },
  markInForce: {
    backgroundColor: {
      default: colors.mutedForeground,
      [media.forcedColors]: "CanvasText",
    },
  },
  markUndone: {
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: {
      default: colors.undone,
      [media.forcedColors]: "CanvasText",
    },
  },
  markUnknown: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: {
      default: colors.faintForeground,
      [media.forcedColors]: "CanvasText",
    },
  },
});
