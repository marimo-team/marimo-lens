import type { Selection } from "@/contracts";

import { getOutputCell } from "@/capture/output-root";

export type RevealMotion = "smooth" | "instant";

export function revealSelection(selection: Selection, motion: RevealMotion): boolean {
  const output = getOutputCell(selection.outputCellId)?.element;
  if (!output || isSubstantiallyVisible(output)) return false;

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  output.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: motion === "smooth" && !reducedMotion ? "smooth" : "auto",
  });
  return true;
}

function isSubstantiallyVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  const requiredHeight = Math.min(rect.height, viewportHeight) * 0.6;
  return visibleHeight >= requiredHeight;
}
