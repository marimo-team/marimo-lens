import type { SelectionTarget } from "@marimo-lens/protocol";

import { parseSelectionTarget } from "@marimo-lens/protocol";

export const REGION_SELECTOR =
  "[data-marimo-lens-target], [data-marimo-lens-inputs], " +
  ":has(> [hidden][data-marimo-lens-cell-id])";
export const DECLARED_TARGET_SELECTOR = `${REGION_SELECTOR}, [data-marimo-lens-cell-id]`;
export const TARGET_SCOPE = "[data-marimo-lens-scope]";

export type TargetSurface = {
  key: string;
  target: SelectionTarget;
  element: HTMLElement;
};

export function surface(target: SelectionTarget, element: HTMLElement): TargetSurface | null {
  try {
    const parsed = parseSelectionTarget(target);
    return { key: JSON.stringify(parsed), target: parsed, element };
  } catch {
    return null;
  }
}

export function queryTarget(ownerDocument: Document, selector: string): HTMLElement | null {
  const matches = queryTargets(ownerDocument, selector);
  return matches.length === 1 ? matches[0]! : null;
}

export function queryTargets(ownerDocument: Document, selector: string): HTMLElement[] {
  try {
    return Array.from(ownerDocument.querySelectorAll(selector)).filter(isHTMLElement);
  } catch {
    return [];
  }
}

export function matchesSelector(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

export function isLensUi(element: Element): boolean {
  return element.closest("[data-marimo-lens-ui]") !== null;
}

export function isVisible(element: HTMLElement): boolean {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) return false;
  const style = ownerWindow.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
  );
}

export function isHTMLElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow !== null && element instanceof ownerWindow.HTMLElement;
}
