import type { LensTarget, ViewportPoint } from "@/types";

import { COLUMN_ATTRIBUTES, columnNamesFromCellId, normalizeColumnName } from "@/lib/column-names";
import { resolveColumn } from "@/lib/column-resolution";
import {
  ancestryCrossingShadow,
  closestCrossingShadow,
  elementsAtPointCrossingShadow,
  queryAllCrossingShadow,
} from "@/lib/shadow-dom";

export { resolveColumn } from "@/lib/column-resolution";

export function bestColumnarTarget(
  element: Element,
  targets: LensTarget[],
  point?: ViewportPoint,
): LensTarget | null {
  const surfaceNames = surfaceColumnNames(element, point);
  const component = surfaceComponentName(element, point);
  const scored = targets
    .map((target) => ({
      target,
      score: scoreColumnarTarget(element, target, surfaceNames, point, component),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null;
  return scored[0].target;
}

function scoreColumnarTarget(
  element: Element,
  target: LensTarget,
  surfaceNames: Set<string>,
  point?: ViewportPoint,
  component?: string | null,
): number {
  const columns = target.columns ?? [];
  if (columns.length === 0) return 0;

  const targetNames = new Set(columns.map((column) => normalizeColumnName(column.name)));
  const overlap = [...surfaceNames].filter((name) => targetNames.has(name)).length;
  const coverage = overlap / columns.length;
  const matchedColumn = resolveColumn(element, target, point);
  const kindBonus = isColumnarTarget(target) ? 2 : 0;
  const componentBonus = component && target.component === component ? 18 : 0;
  const outputPenalty = target.kind === "output" ? -4 : 0;
  return (
    overlap * 10 +
    Math.round(coverage * 10) +
    (matchedColumn ? 6 : 0) +
    kindBonus +
    componentBonus +
    outputPenalty
  );
}

export function isColumnarTarget(target: LensTarget): boolean {
  return isColumnarDomTarget(target) || isColumnarGridTarget(target);
}

export function isColumnarDomTarget(target: LensTarget): boolean {
  return target.capabilities?.columnarDom === true;
}

export function isColumnarGridTarget(target: LensTarget): boolean {
  return target.capabilities?.columnarGrid === true;
}

export function isVisualTarget(target: LensTarget): boolean {
  return target.capabilities?.visualSurface === true || target.capabilities?.chartPart === true;
}

export function isMediaTarget(target: LensTarget): boolean {
  return target.capabilities?.media === true;
}

export function isDocumentTarget(target: LensTarget): boolean {
  return target.capabilities?.document === true;
}

export function isInteractiveTarget(target: LensTarget): boolean {
  return target.capabilities?.interactive === true;
}

function surfaceColumnNames(element: Element, point?: ViewportPoint): Set<string> {
  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = normalizeColumnName(value);
    if (normalized) names.add(normalized);
  };
  const addFromAttributes = (candidate: Element) => {
    for (const attribute of COLUMN_ATTRIBUTES) {
      add(candidate.getAttribute(attribute));
    }
    for (const name of columnNamesFromCellId(candidate.getAttribute("data-cell-id"))) {
      add(name);
    }
  };

  for (const candidate of [element, ...elementsAtPointCrossingShadow(point)]) {
    for (const ancestor of ancestryCrossingShadow(candidate)) {
      addFromAttributes(ancestor);
    }
  }

  const surface = closestCrossingShadow(element, "table,[role='grid'],[role='table']");
  if (!surface) return names;

  for (const header of queryAllCrossingShadow(
    surface,
    "th,[role='columnheader'],[data-column],[data-column-name],[data-field],[data-cell-id]",
  )) {
    addFromAttributes(header);
    add(header.textContent);
    add(header.getAttribute("aria-label"));
    add(header.getAttribute("title"));
  }
  return names;
}

function surfaceComponentName(element: Element, point?: ViewportPoint): string | null {
  for (const candidate of [element, ...elementsAtPointCrossingShadow(point)]) {
    for (const ancestor of ancestryCrossingShadow(candidate)) {
      const tag = ancestor.tagName.toLowerCase();
      if (tag.startsWith("marimo-") && tag !== "marimo-ui-element") return tag;
    }
  }
  return null;
}
