import { identifyElement } from "@/lib/element-identification";
import type {
  LensChartPart,
  LensColumn,
  LensTarget,
  SelectionGranularity,
  SelectionHighlight,
  SemanticSelection,
  SerializedSemanticSelection,
} from "@/types";

type SurfaceSemanticSelectionOptions = {
  target: LensTarget;
  id?: string;
  kind: string;
  granularity?: SelectionGranularity;
  label?: string;
  element: Element;
  sourceElement?: Element;
  score?: number;
  data?: Record<string, unknown>;
  hitKind?: string;
  selector?: string;
  highlight?: SelectionHighlight;
};

const MIN_RECT_SIZE = 2;

export function surfaceSemanticSelection({
  target,
  id,
  kind,
  granularity = "surface",
  label,
  element,
  sourceElement,
  data,
  hitKind,
  selector,
  highlight,
}: SurfaceSemanticSelectionOptions): SemanticSelection {
  const evidenceElement = sourceElement ?? element;
  const identified = identifyElement(evidenceElement);
  return {
    id: id ?? `${kind}:${target.id}`,
    targetId: target.id,
    kind,
    granularity,
    label: label ?? target.variable ?? target.label,
    parentId: target.id,
    data,
    evidence: [
      {
        kind: "dom-hit",
        hitKind: hitKind ?? kind,
        selector,
        element: evidenceElement,
        elementName: identified.name,
      },
    ],
    highlight: highlight ?? {
      kind: "element",
      element,
      strategy: kind,
    },
    anchor: {
      element: evidenceElement,
      selector,
    },
  };
}

export function serializeSemanticSelection(
  selection: SemanticSelection,
): SerializedSemanticSelection {
  const rect = semanticHighlightRect(selection.highlight);
  const anchor = { ...selection.anchor };
  delete anchor.element;
  return {
    id: selection.id,
    targetId: selection.targetId,
    kind: selection.kind,
    granularity: selection.granularity,
    label: selection.label,
    parentId: selection.parentId,
    data: selection.data,
    evidence: selection.evidence.map((item) => {
      const evidence = { ...item };
      delete evidence.element;
      return evidence;
    }),
    highlight: {
      kind: selection.highlight.kind,
      strategy: selection.highlight.strategy,
      padding: selection.highlight.padding,
      boundingBox: rect ? rectToBox(rect) : undefined,
    },
    anchor,
  };
}

export function semanticHighlightElement(highlight: SelectionHighlight): Element | null {
  if (highlight.kind === "element") return highlight.element;
  if (highlight.kind === "elements") {
    return highlight.elements[0] ?? highlight.fallbackElement ?? null;
  }
  return null;
}

export function semanticAnchorElement(selection: SemanticSelection): Element | null {
  return selection.anchor.element ?? semanticHighlightElement(selection.highlight);
}

export function semanticHighlightRect(highlight: SelectionHighlight): DOMRect | null {
  if (highlight.kind === "rect") return paddedRect(highlight.rect, highlight.padding ?? 0);
  if (highlight.kind === "element") {
    return usableElementRect(highlight.element, highlight.padding);
  }

  const rects = highlight.elements
    .map((element) => usableElementRect(element, 0))
    .filter((rect): rect is DOMRect => rect !== null);
  const union = unionRects(rects);
  if (union) return paddedRect(union, highlight.padding ?? 0);
  return highlight.fallbackElement
    ? usableElementRect(highlight.fallbackElement, highlight.padding)
    : null;
}

export function columnFromSemanticSelection(
  selection: SemanticSelection,
  target: LensTarget,
): LensColumn | undefined {
  const columnName = selection.data?.column;
  if (typeof columnName !== "string") return undefined;
  return (target.columns ?? []).find((column) => column.name === columnName);
}

export function chartPartFromSemanticSelection(selection: SemanticSelection): LensChartPart | null {
  const chartPart = selection.data?.chartPart;
  if (!isChartPart(chartPart)) return null;
  return chartPart;
}

function usableElementRect(element: Element, padding = 0): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < MIN_RECT_SIZE || rect.height < MIN_RECT_SIZE) return null;
  return paddedRect(rect, padding);
}

function unionRects(rects: DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return createDomRect(left, top, right - left, bottom - top);
}

function paddedRect(rect: DOMRect, padding: number): DOMRect {
  if (padding <= 0) return rect;
  return createDomRect(
    rect.left - padding,
    rect.top - padding,
    rect.width + padding * 2,
    rect.height + padding * 2,
  );
}

function rectToBox(rect: DOMRect): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function createDomRect(x: number, y: number, width: number, height: number): DOMRect {
  if (typeof DOMRect !== "undefined") return new DOMRect(x, y, width, height);
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({ x, y, width, height }),
  } as DOMRect;
}

function isChartPart(value: unknown): value is LensChartPart {
  if (!value || typeof value !== "object") return false;
  const part = value as Partial<LensChartPart>;
  return typeof part.kind === "string" && typeof part.label === "string";
}
