import { cellElement, isUsableRegion } from "@/lib/cell-regions";
import { semanticAnchorElement, semanticHighlightRect } from "@/selection/semantic-selection";
import type {
  LensAnnotation,
  LensAnnotationAnchor,
  LensAnchorPathStep,
  ResolvedHover,
} from "@/types";

type MarkerPosition = {
  left: number;
  top: number;
};

const CENTER = { x: 0.5, y: 0.5 };

export function createAnnotationAnchor(hover: ResolvedHover): LensAnnotationAnchor {
  const anchorElement = semanticAnchorElement(hover.semanticSelection) ?? hover.element;
  const liveRect = semanticHighlightRect(hover.semanticSelection.highlight);
  const rect = liveRect && isUsableRegion(liveRect) ? liveRect : hover.rect;
  const point = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  const rootCellId = hover.displayCellId ?? hover.target.cellId ?? null;
  const root = rootCellId ? cellElement(rootCellId) : null;
  const rootRect = root?.getBoundingClientRect() ?? null;
  const selectorPath = root ? selectorPathFromRoot(root, anchorElement) : undefined;
  const cellOffset =
    rootRect && isUsableRegion(rootRect)
      ? {
          x: point.x - rootRect.left,
          y: point.y - rootRect.top,
        }
      : undefined;

  return {
    version: 1,
    fixed: isFixedOrSticky(anchorElement),
    rootCellId,
    elementPath: hover.elementPath,
    selectorPath,
    elementOffset: CENTER,
    cellOffset,
    viewportPoint: point,
    documentPoint: {
      x: point.x + window.scrollX,
      y: point.y + window.scrollY,
    },
  };
}

export function markerPosition(annotation: LensAnnotation): MarkerPosition {
  const anchor = annotation.anchor;
  if (anchor) {
    const live = markerPositionFromAnchor(annotation, anchor);
    if (live) return live;
  }
  return legacyMarkerPosition(annotation);
}

function markerPositionFromAnchor(
  annotation: LensAnnotation,
  anchor: LensAnnotationAnchor,
): MarkerPosition | null {
  const root = rootElementForAnnotation(annotation, anchor);
  const resolved = root && resolveSelectorPath(root, anchor.selectorPath);
  if (resolved) {
    const rect = resolved.getBoundingClientRect();
    if (isUsableRegion(rect)) {
      const offset = anchor.elementOffset ?? CENTER;
      return {
        left: rect.left + rect.width * clampRatio(offset.x),
        top: rect.top + rect.height * clampRatio(offset.y),
      };
    }
  }

  if (root && anchor.cellOffset) {
    const rect = root.getBoundingClientRect();
    if (isUsableRegion(rect)) {
      return {
        left: rect.left + anchor.cellOffset.x,
        top: rect.top + anchor.cellOffset.y,
      };
    }
  }

  if (anchor.fixed && anchor.viewportPoint) {
    return {
      left: anchor.viewportPoint.x,
      top: anchor.viewportPoint.y,
    };
  }

  return null;
}

function rootElementForAnnotation(
  annotation: LensAnnotation,
  anchor: LensAnnotationAnchor,
): Element | null {
  const cellId = anchor.rootCellId ?? annotation.displayCellId ?? annotation.cellId ?? null;
  return cellId ? cellElement(cellId) : null;
}

function legacyMarkerPosition(annotation: {
  documentX: number;
  documentY: number;
}): MarkerPosition {
  return {
    left: annotation.documentX - window.scrollX,
    top: annotation.documentY - window.scrollY,
  };
}

function selectorPathFromRoot(root: Element, element: Element): LensAnchorPathStep[] | undefined {
  const path: LensAnchorPathStep[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const step = selectorStepFor(current);
    const parent: Element | null = current.parentElement;
    if (parent) {
      path.unshift(step);
      current = parent;
      continue;
    }
    const ownerRoot = current.getRootNode?.();
    if (ownerRoot instanceof ShadowRoot) {
      path.unshift({ ...step, shadow: true });
      current = ownerRoot.host;
      continue;
    }
    return undefined;
  }
  return current === root && path.length > 0 ? path : undefined;
}

function resolveSelectorPath(
  root: Element,
  path: LensAnchorPathStep[] | undefined,
): Element | null {
  if (!path?.length) return null;
  let current: Element | null = root;
  for (const step of path) {
    if (!current) return null;
    const searchRoot = step.shadow && current instanceof HTMLElement ? current.shadowRoot : current;
    if (!searchRoot) return null;
    current = queryDirectChild(searchRoot, step.selector);
  }
  return current;
}

function queryDirectChild(root: ParentNode, selector: string): Element | null {
  try {
    if (root instanceof Element) {
      return root.querySelector(`:scope > ${selector}`);
    }
    for (const child of Array.from(root.children)) {
      if (child.matches(selector)) return child;
    }
  } catch {
    return null;
  }
  return null;
}

function selectorStepFor(element: Element): LensAnchorPathStep {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id) return { selector: `${tag}#${cssEscape(id)}` };

  for (const attr of ["data-marimo-lens-var", "data-testid", "role", "aria-label"]) {
    const value = element.getAttribute(attr);
    if (value) {
      return {
        selector: `${tag}[${attr}="${cssString(value)}"]:nth-of-type(${nthOfType(element)})`,
      };
    }
  }

  const stableClass = stableClassName(element.className);
  const classSelector = stableClass ? `.${cssEscape(stableClass)}` : "";
  return { selector: `${tag}${classSelector}:nth-of-type(${nthOfType(element)})` };
}

function nthOfType(element: Element): number {
  const tag = element.tagName;
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === tag) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function isFixedOrSticky(element: Element): boolean {
  let current: Element | null = element;
  while (current && current !== document.body) {
    const position = window.getComputedStyle(current).position;
    if (position === "fixed" || position === "sticky") return true;
    const parent: Element | null = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }
    const root = current.getRootNode?.();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

function stableClassName(className: unknown): string {
  if (typeof className !== "string") return "";
  for (const part of className.split(/\s+/)) {
    if (part.length > 2 && !/[A-Z0-9]{6,}/.test(part)) return part;
  }
  return "";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/["\\#.:,[\]>+~*=\s]/g, "\\$&");
}

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
