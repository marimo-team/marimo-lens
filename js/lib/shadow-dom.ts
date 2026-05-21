import type { ViewportPoint } from "@/types";

export function closestCrossingShadow(element: Element | null, selector: string): Element | null {
  for (const current of ancestryCrossingShadow(element)) {
    try {
      if (current.matches(selector)) {
        return current;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function ancestryCrossingShadow(element: Element | null): Element[] {
  const ancestry: Element[] = [];
  let current: Element | null = element;
  while (current) {
    if (current instanceof Element) {
      ancestry.push(current);
    }
    current = parentCrossingShadow(current);
  }
  return ancestry;
}

function parentCrossingShadow(element: Element): Element | null {
  const parent = element.parentElement;
  if (parent) return parent;
  const root = element.getRootNode?.();
  return root instanceof ShadowRoot ? root.host : null;
}

export function queryAllCrossingShadow(root: ParentNode, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (node: ParentNode) => {
    const elements = "querySelectorAll" in node ? node.querySelectorAll("*") : [];
    if ("querySelectorAll" in node) {
      for (const match of node.querySelectorAll(selector)) {
        if (match instanceof Element) found.push(match);
      }
    }
    for (const element of elements) {
      if (element instanceof HTMLElement && element.shadowRoot) {
        visit(element.shadowRoot);
      }
    }
  };

  try {
    visit(root);
  } catch {
    return found;
  }
  return found;
}

export function queryFirstCrossingShadow(root: ParentNode, selector: string): Element | null {
  return queryAllCrossingShadow(root, selector)[0] ?? null;
}

export function elementsAtPointCrossingShadow(point?: ViewportPoint): Element[] {
  if (!point) return [];
  const found: Element[] = [];
  const seen = new Set<Element>();
  const add = (element: Element | null) => {
    for (const candidate of ancestryCrossingShadow(element)) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        found.push(candidate);
      }
    }
  };

  const visit = (elements: Element[]) => {
    for (const element of elements) {
      if (seen.has(element)) continue;
      add(element);
      const root = element instanceof HTMLElement ? element.shadowRoot : null;
      const shadowElements = root?.elementsFromPoint?.(point.x, point.y) ?? [];
      if (shadowElements.length > 0) visit(shadowElements);
    }
  };

  const documentElements = document.elementsFromPoint?.(point.x, point.y) ?? [];
  visit(documentElements);
  return found;
}
