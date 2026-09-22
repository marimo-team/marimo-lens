import type { Selection, TargetSelector } from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { ViewportBounds } from "@/notebook/viewport";

export type RevealMotion = "smooth" | "instant";

export function revealSelection(
  dom: NotebookDomAdapter,
  selection: Selection,
  motion: RevealMotion,
  selector: TargetSelector,
): boolean {
  const output = dom.getTarget(selection.target, selector)?.element;
  if (!output || isSubstantiallyVisible(output.getBoundingClientRect(), dom.viewportBounds())) {
    return false;
  }

  const reducedMotion =
    dom.window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  output.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: motion === "smooth" && !reducedMotion ? "smooth" : "auto",
  });
  return true;
}

function isSubstantiallyVisible(rect: DOMRectReadOnly, viewport: ViewportBounds): boolean {
  const visibleWidth = Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left);
  const visibleHeight = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
  return (
    visibleWidth >= Math.min(rect.width, viewport.width) * 0.6 &&
    visibleHeight >= Math.min(rect.height, viewport.height) * 0.6
  );
}
