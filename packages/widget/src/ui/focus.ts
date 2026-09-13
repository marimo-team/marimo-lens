import type { KeyboardEvent } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

export function focusSelectionOrDock(dom: NotebookDomAdapter, selectionId: string): void {
  const target = selectionFocusTarget(dom.uiRoot, selectionId) ?? dockFocusTarget(dom.uiRoot);
  if (!target) return;
  dom.window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}

function selectionFocusTarget(
  ownerDocument: Document | ShadowRoot,
  selectionId: string,
): HTMLElement | null {
  return (
    [
      ...ownerDocument.querySelectorAll<HTMLElement>(
        "[data-marimo-lens-selection-focus], [data-marimo-lens-selection-id]",
      ),
    ].find(
      (element) =>
        element.dataset.marimoLensSelectionFocus === selectionId ||
        element.dataset.marimoLensSelectionId === selectionId,
    ) ?? null
  );
}

export function focusDock(dom: NotebookDomAdapter): void {
  focusSelector(dom, "[data-ml-select]");
}

export function focusListTrigger(dom: NotebookDomAdapter): void {
  focusSelector(dom, "[data-ml-list]");
}

export function moveSelectionRowFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const panel = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]');
  if (!panel) return;
  const rows = Array.from(
    panel.querySelectorAll<HTMLButtonElement>("[data-marimo-lens-selection-focus]:not(:disabled)"),
  );
  const current = rows.indexOf(event.currentTarget);
  if (current < 0) return;
  const next = Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowUp" ? -1 : 1)));

  event.preventDefault();
  const row = rows[next];
  if (!row || row === event.currentTarget) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

function focusSelector(dom: NotebookDomAdapter, selector: string): void {
  const target = dom.uiRoot.querySelector<HTMLElement>(selector);
  if (!target) return;
  dom.window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}

function dockFocusTarget(ownerDocument: Document | ShadowRoot): HTMLElement | null {
  const dock = ownerDocument.querySelector<HTMLElement>("[data-marimo-lens-dock]");
  if (!dock) return null;
  return (
    dock.querySelector<HTMLElement>("[data-ml-dock-tab]") ??
    [...dock.querySelectorAll<HTMLButtonElement>("button")].find((button) => !button.disabled) ??
    null
  );
}
