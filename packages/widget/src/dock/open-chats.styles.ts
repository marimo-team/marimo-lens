import * as stylex from "@stylexjs/stylex";

import { colors } from "../styles/tokens.stylex";

export const openChatStyles = stylex.create({
  list: {
    display: "flex",
    margin: 0,
    padding: 0,
    flexDirection: "column",
    listStyle: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    minHeight: 56,
    padding: "9px 12px",
    alignItems: "center",
    gap: 9,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  chip: {
    color: colors.mutedForeground,
  },
  details: {
    display: "grid",
    minWidth: 0,
    gap: 2,
  },
  note: {
    display: "-webkit-box",
    overflow: "hidden",
    color: colors.foreground,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "17px",
    overflowWrap: "anywhere",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  metadata: {
    color: colors.mutedForeground,
    fontSize: 11,
  },
});
