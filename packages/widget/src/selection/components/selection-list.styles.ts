import * as stylex from "@stylexjs/stylex";

import { colors, media } from "../../styles/tokens.stylex";
import { selectionSummaryMarker } from "./selection-markers.stylex";

export const selectionListStyles = stylex.create({
  items: {
    display: "flex",
    minHeight: 0,
    margin: 0,
    padding: 0,
    flex: "1 0 auto",
    flexDirection: "column",
    gap: 2,
    listStyle: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) auto", [media.compact]: "minmax(0, 1fr)" },
    minHeight: 56,
    flexShrink: 0,
    alignItems: "center",
  },
  itemNeutral: {
    backgroundColor: {
      default: "transparent",
      ":focus-within": `color-mix(in srgb, ${colors.primary} 9%, transparent)`,
    },
  },
  itemCurrent: {
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.primary} 5%, transparent)`,
      ":focus-within": `color-mix(in srgb, ${colors.primary} 9%, transparent)`,
    },
    outline: { [media.forcedColors]: "2px solid Highlight" },
    outlineOffset: { [media.forcedColors]: -2 },
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    minWidth: 0,
    minHeight: { default: 55, [media.coarsePointer]: 44 },
    padding: "7px 6px 7px 12px",
    alignItems: "center",
    gap: 9,
    backgroundColor: {
      default: "transparent",
      ":focus-visible": "transparent",
      [media.hover]: { ":not(:disabled):hover": colors.hover },
    },
    textAlign: "left",
    outline: {
      ":focus-visible": "none",
      [media.forcedColors]: { ":focus-visible": "2px solid Highlight" },
    },
    outlineOffset: { [media.forcedColors]: { ":focus-visible": -2 } },
  },
  labelNeutral: {
    color: {
      default: colors.foreground,
      [stylex.when.ancestor(":focus-visible", selectionSummaryMarker)]: colors.onPrimary,
    },
    backgroundColor: {
      default: colors.surfaceSubtle,
      [stylex.when.ancestor(":focus-visible", selectionSummaryMarker)]: colors.primarySolid,
    },
  },
  labelCurrent: {
    color: {
      default: colors.accentForeground,
      [stylex.when.ancestor(":focus-visible", selectionSummaryMarker)]: colors.onPrimary,
    },
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.primary} 10%, transparent)`,
      [stylex.when.ancestor(":focus-visible", selectionSummaryMarker)]: colors.primarySolid,
    },
  },
  details: {
    display: "grid",
    minWidth: 0,
    gap: 2,
  },
  note: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: 600,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  noteEmpty: {
    color: colors.mutedForeground,
    fontStyle: "italic",
    fontWeight: 400,
  },
  metadata: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 3,
    color: colors.mutedForeground,
    fontSize: 11,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  availability: {
    fontWeight: 500,
  },
  actions: {
    display: "flex",
    gap: 1,
    paddingRight: 8,
    paddingBottom: { [media.compact]: 4 },
    justifyContent: { [media.compact]: "flex-end" },
  },
  footer: {
    display: "flex",
    minHeight: 38,
    padding: "4px 8px 0",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  clear: {
    minHeight: { default: 30, [media.coarsePointer]: 44 },
  },
});
