import * as stylex from "@stylexjs/stylex";

import { colors, media, radii } from "../../styles/tokens.stylex";

export const overlayStyles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
  },
  fixedAnchor: {
    position: "fixed",
    pointerEvents: "none",
  },
  outputHighlight: {
    backgroundColor: `color-mix(in srgb, ${colors.primary} 3%, transparent)`,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: { default: colors.primary, [media.forcedColors]: "Highlight" },
    borderRadius: radii.label,
  },
  anchorPreview: {
    zIndex: 2,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.primary, [media.forcedColors]: "Highlight" },
    boxShadow: `0 0 0 1px ${colors.surface}`,
  },
  anchorPoint: {
    width: 14,
    height: 14,
    backgroundColor: colors.primary,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
  },
  anchorRect: {
    backgroundColor: `color-mix(in srgb, ${colors.primary} 9%, transparent)`,
    borderRadius: 4,
  },
});
