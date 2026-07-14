export function scrollableAncestors(element: Element): EventTarget[] {
  const targets: EventTarget[] = [window];
  let current: Element | null = element;
  while (current) {
    const parent: Element | null = current.parentElement;
    if (parent) {
      if (isScrollable(parent)) targets.push(parent);
      current = parent;
      continue;
    }
    const root = current.getRootNode?.();
    if (root instanceof ShadowRoot) {
      if (isScrollable(root.host)) targets.push(root.host);
      current = root.host;
      continue;
    }
    current = null;
  }
  return [...new Set(targets)];
}

function isScrollable(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
}
