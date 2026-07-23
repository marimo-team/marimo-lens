import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

export function focusSelectionOrDock(dom: NotebookDomAdapter, selectionId: string): void {
  const target = selectionFocusTarget(dom.document, selectionId) ?? dockFocusTarget(dom.document);
  if (!target) return;
  dom.window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}

function selectionFocusTarget(ownerDocument: Document, selectionId: string): HTMLElement | null {
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

function focusSelector(dom: NotebookDomAdapter, selector: string): void {
  const target = dom.document.querySelector<HTMLElement>(selector);
  if (!target) return;
  dom.window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}

function dockFocusTarget(ownerDocument: Document): HTMLElement | null {
  const dock = ownerDocument.querySelector<HTMLElement>("[data-marimo-lens-dock]");
  if (!dock) return null;
  return (
    dock.querySelector<HTMLElement>("[data-ml-dock-tab]") ??
    [...dock.querySelectorAll<HTMLButtonElement>("button")].find((button) => !button.disabled) ??
    null
  );
}
