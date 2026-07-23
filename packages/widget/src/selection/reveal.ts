import type { Selection } from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

export type RevealMotion = "smooth" | "instant";

export function revealSelection(
  dom: NotebookDomAdapter,
  selection: Selection,
  motion: RevealMotion,
): boolean {
  const output = dom.getOutputCell(selection.outputCellId)?.element;
  if (!output || isSubstantiallyVisible(dom, output)) return false;

  const reducedMotion =
    typeof dom.window.matchMedia === "function" &&
    dom.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  output.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: motion === "smooth" && !reducedMotion ? "smooth" : "auto",
  });
  return true;
}

function isSubstantiallyVisible(dom: NotebookDomAdapter, element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const viewportHeight = dom.window.innerHeight || dom.document.documentElement.clientHeight;
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  const requiredHeight = Math.min(rect.height, viewportHeight) * 0.6;
  return visibleHeight >= requiredHeight;
}
