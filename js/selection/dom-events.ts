import { closestCrossingShadow } from "@/lib/shadow-dom";

export function isLensInterfaceElement(element: Element | null): boolean {
  return Boolean(closestCrossingShadow(element, "[data-marimo-lens-ui]"));
}

export function isLensInterfaceEvent(event: MouseEvent | PointerEvent): boolean {
  const path = event.composedPath?.() ?? [];
  return path.some((item) => item instanceof Element && isLensInterfaceElement(item));
}

export function eventTargetElement(event: MouseEvent | PointerEvent): Element | null {
  const path = event.composedPath?.() ?? [];
  for (const item of path) {
    if (item instanceof Element && !isLensInterfaceElement(item)) {
      return item;
    }
  }
  return document.elementFromPoint(event.clientX, event.clientY);
}
