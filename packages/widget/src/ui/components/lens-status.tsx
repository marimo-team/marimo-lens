import type { ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";

import { ui } from "../../styles/primitives";

/** A visually hidden polite live region, named by one `data-marimo-lens-*-status` attribute. */
export function LiveRegion({
  children,
  ...name
}: { children: ReactNode } & { [attribute: `data-marimo-lens-${string}status`]: true }) {
  return (
    <output {...stylex.props(ui.visuallyHidden)} {...name} aria-live="polite" aria-atomic="true">
      {children}
    </output>
  );
}

export function LensStatus({ message }: { message: string }) {
  return <LiveRegion data-marimo-lens-status>{message}</LiveRegion>;
}
