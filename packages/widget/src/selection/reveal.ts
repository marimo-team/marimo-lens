import type { Selection, TargetSelector } from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

export type RevealMotion = "smooth" | "instant";

export function revealSelection(
  dom: NotebookDomAdapter,
  selection: Selection,
  motion: RevealMotion,
  selector: TargetSelector,
): boolean {
  const output = dom.getTarget(selection.target, selector)?.element;
  if (!output || isSubstantiallyVisible(dom, output)) return false;

  const reducedMotion =
    dom.window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
