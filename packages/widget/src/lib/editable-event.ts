export function isEditableKeyboardEvent(event: KeyboardEvent): boolean {
  return event.defaultPrevented || editableEventPath(event).some(isEditableTarget);
}

function editableEventPath(event: KeyboardEvent): EventTarget[] {
  const path = event.composedPath();
  if (path.length > 0) return path;
  return event.target ? [event.target] : [];
}

function isEditableTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editingHost = target.closest(
    [
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="menuitem"]',
      '[role="radio"]',
      '[role="searchbox"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="textbox"]',
      ".cm-editor",
      ".cm-content",
      '[data-testid="code-editor"]',
    ].join(","),
  );
  return (
    Boolean(editingHost) ||
    target.tagName === "BUTTON" ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.hasAttribute("tabindex") ||
    target.isContentEditable
  );
}
