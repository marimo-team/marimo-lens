export function focusSelectionOrDock(selectionId: string): void {
  window.requestAnimationFrame(() => {
    const marker = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-id="${CSS.escape(selectionId)}"]`,
    );
    (marker ?? document.querySelector<HTMLElement>("[data-ml-select]"))?.focus();
  });
}

export function focusDock(): void {
  focusSelector("[data-ml-select]");
}

export function focusListTrigger(): void {
  focusSelector("[data-ml-list]");
}

export function focusMenuTrigger(): void {
  focusSelector("[data-ml-menu]");
}

function focusSelector(selector: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;
  window.requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}
