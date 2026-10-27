import * as stylex from "@stylexjs/stylex";

import { colors, media } from "../../styles/tokens.stylex";

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
});
