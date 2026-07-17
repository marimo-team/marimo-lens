export function focusSelectionOrDock(selectionId: string): void {
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-focus="${CSS.escape(selectionId)}"], [data-marimo-lens-selection-id="${CSS.escape(selectionId)}"]`,
    );
    (target ?? dockFocusTarget())?.focus();
  });
}

export function focusDock(): void {
  focusSelector("[data-ml-select]");
}

export function focusListTrigger(): void {
  focusSelector("[data-ml-list]");
}

function focusSelector(selector: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;
  window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}

function dockFocusTarget(): HTMLElement | null {
  const dock = document.querySelector<HTMLElement>("[data-marimo-lens-dock]");
  if (!dock) return null;
  return (
    dock.querySelector<HTMLElement>("[data-ml-dock-tab]") ??
    [...dock.querySelectorAll<HTMLButtonElement>("button")].find((button) => !button.disabled) ??
    null
  );
}
