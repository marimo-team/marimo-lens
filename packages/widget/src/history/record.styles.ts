import * as stylex from "@stylexjs/stylex";

import { historyDisclosureMarker } from "../selection/components/selection-markers.stylex";
import { colors, fonts, radii } from "../styles/tokens.stylex";

export const recordStyles = stylex.create({
  chip: {
    marginTop: 1,
    color: colors.mutedForeground,
  },
  summary: {
    display: "grid",
    minWidth: 0,
    gap: 3,
  },
  head: {
    display: "flex",
    minWidth: 0,
    flexWrap: "wrap",
    alignItems: "center",
    gap: "2px 6px",
    fontSize: 11,
    lineHeight: "14px",
  },
  when: {
    color: colors.mutedForeground,
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  target: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    color: colors.mutedForeground,
  },
  targetLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  quote: {
    display: "-webkit-box",
    margin: 0,
    overflow: "hidden",
    color: colors.foreground,
    fontSize: 12,
    lineHeight: "16px",
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    // An expanded History entry shows its whole note.
    WebkitLineClamp: {
      default: 2,
      [stylex.when.ancestor("[open]", historyDisclosureMarker)]: "unset",
    },
  },
  quoteEmpty: {
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
  cells: {
    display: "flex",
    minWidth: 0,
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    color: colors.mutedForeground,
    fontSize: 11,
    lineHeight: "16px",
  },
  cell: {
    display: "inline-flex",
    maxWidth: "100%",
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    padding: "0 5px",
    color: colors.foreground,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.label,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: "16px",
  },
  cellName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  undoer: {
    color: colors.foreground,
  },
  lost: {
    display: "grid",
    gap: 2,
    margin: 0,
    padding: "3px 0 3px 8px",
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: colors.undone,
    color: colors.mutedForeground,
    fontSize: 11,
  },
  lostCode: {
    overflow: "hidden",
    color: colors.foreground,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: "15px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
