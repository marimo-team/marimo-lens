import * as stylex from "@stylexjs/stylex";

import { colors, media } from "../../styles/tokens.stylex";

export const resizeHandleStyles = stylex.create({
  resizeHandle: {
    opacity: 1,
    position: "absolute",
    zIndex: 2,
    width: 12,
    height: 12,
    padding: 0,
    pointerEvents: "auto",
    touchAction: "none",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.primary, [media.forcedColors]: "Highlight" },
    borderRadius: 2,
    boxShadow: "0 1px 3px rgb(15 23 42 / 16%)",
    "::after": {
      position: "absolute",
      inset: { default: -6, [media.coarsePointer]: -13 },
      content: "",
    },
  },
  nw: {
    top: 0,
    left: 0,
    cursor: "nwse-resize",
    transform: "translate(-50%, -50%)",
  },
  ne: {
    top: 0,
    right: 0,
    cursor: "nesw-resize",
    transform: "translate(50%, -50%)",
  },
  sw: {
    bottom: 0,
    left: 0,
    cursor: "nesw-resize",
    transform: "translate(-50%, 50%)",
  },
  se: {
    right: 0,
    bottom: 0,
    cursor: "nwse-resize",
    transform: "translate(50%, 50%)",
  },
});
