import type { HistoryChange } from "@marimo-lens/protocol";
import type { ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";

import { changeStatusStyles } from "./change-status.styles";

export type ChangeStatus = HistoryChange["status"];

/** How the record names a change status. */
export const CHANGE_STATUS_TEXT = {
  in_force: "Still applied",
  undone: "Undone",
  unknown: "Status unknown",
} satisfies Record<ChangeStatus, string>;

const MARK_STYLES = {
  in_force: changeStatusStyles.markInForce,
  undone: changeStatusStyles.markUndone,
  unknown: changeStatusStyles.markUnknown,
} as const;

/** One status vocabulary for the record: a dot holds, a ring was undone, a dashed ring is unknown. */
export function ChangeStatusMark({ status }: { status: ChangeStatus }) {
  return (
    <span
      {...stylex.props(changeStatusStyles.mark, MARK_STYLES[status])}
      data-marimo-lens-change-status={status}
      aria-hidden="true"
    />
  );
}

export function ChangeStatusLabel({
  status,
  children,
}: {
  status: ChangeStatus;
  children?: ReactNode;
}) {
  return (
    <span {...stylex.props(changeStatusStyles.status, changeStatusStyles[status])}>
      <ChangeStatusMark status={status} />
      {children ?? CHANGE_STATUS_TEXT[status]}
    </span>
  );
}
