import * as stylex from "@stylexjs/stylex";

import { colors } from "../styles/tokens.stylex";

export const earlierStyles = stylex.create({
  section: {
    display: "grid",
    maxHeight: 220,
    overflowY: "auto",
    gap: 2,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    overscrollBehavior: "contain",
  },
  title: {
    margin: 0,
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: 700,
  },
  list: {
    display: "grid",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    gap: 8,
    padding: "6px 0",
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
});
