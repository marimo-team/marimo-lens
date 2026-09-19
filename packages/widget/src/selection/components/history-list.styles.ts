import * as stylex from "@stylexjs/stylex";

import { colors, media } from "../../styles/tokens.stylex";
import { historyDisclosureMarker } from "./selection-markers.stylex";

export const historyStyles = stylex.create({
  list: {
    display: "flex",
    margin: 0,
    padding: 0,
    flexDirection: "column",
    gap: 2,
    listStyle: "none",
  },
  item: {
    position: "relative",
    display: { [media.compact]: "grid" },
    minHeight: 42,
    backgroundColor: { ":focus-within": colors.hover },
  },
  disclosure: {
    minWidth: 0,
    borderRadius: "inherit",
  },
  row: {
    display: "grid",
    minHeight: { default: 42, [media.coarsePointer]: 58 },
    padding: { default: "5px 88px 5px 8px", [media.compact]: "5px 8px" },
    alignItems: "center",
    gridTemplateColumns: {
      default: "auto minmax(0, 1fr) auto 14px",
      [media.compact]: "auto minmax(0, 1fr) 14px",
    },
    gap: 7,
    cursor: "pointer",
    listStyle: "none",
    backgroundColor: {
      [media.hover]: { ":hover": colors.hover },
      [stylex.when.ancestor("[open]", historyDisclosureMarker)]: colors.hover,
    },
    outline: {
      ":focus-visible": `2px solid ${colors.focus}`,
      [media.forcedColors]: { ":focus-visible": "2px solid Highlight" },
    },
    outlineOffset: { ":focus-visible": -2 },
    "::-webkit-details-marker": { display: "none" },
  },
  target: {
    minWidth: 0,
    color: colors.mutedForeground,
    fontSize: 11,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  date: {
    gridRow: { [media.compact]: 2 },
    gridColumn: { [media.compact]: 2 },
    color: colors.mutedForeground,
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  chevron: {
    color: colors.mutedForeground,
    transform: {
      default: "none",
      [stylex.when.ancestor("[open]", historyDisclosureMarker)]: "rotate(180deg)",
    },
  },
  details: {
    display: "grid",
    gap: 6,
    padding: "2px 12px 10px 45px",
    backgroundColor: {
      [stylex.when.ancestor("[open]", historyDisclosureMarker)]: colors.hover,
    },
  },
  detailRow: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "start",
    gap: 7,
  },
  author: {
    display: "inline-flex",
    width: 16,
    height: 17,
    alignItems: "center",
    justifyContent: "center",
    color: colors.mutedForeground,
  },
  detailText: {
    minWidth: 0,
    margin: 0,
    color: colors.foreground,
    fontSize: 12,
    lineHeight: "17px",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
  addressedAt: {
    color: colors.mutedForeground,
    fontSize: 10,
  },
  reopen: {
    position: { default: "absolute", [media.compact]: "static" },
    zIndex: 1,
    top: 7,
    right: 8,
    minWidth: 64,
    minHeight: { default: 28, [media.coarsePointer]: 44 },
    margin: { [media.compact]: "0 8px 6px" },
    padding: "0 6px",
    justifySelf: { [media.compact]: "end" },
    color: colors.mutedForeground,
    fontSize: 11,
  },
});
