import * as stylex from "@stylexjs/stylex";

import { ui } from "../../styles/primitives";

export function LensStatus({ message }: { message: string }) {
  return (
    <output
      {...stylex.props(ui.visuallyHidden)}
      data-marimo-lens-status
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </output>
  );
}
