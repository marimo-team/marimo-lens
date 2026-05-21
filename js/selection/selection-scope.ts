import type { SelectionScope } from "@/selection/selection-plugin";
import type { LensTarget, SelectionSurface } from "@/types";

import { closestCrossingShadow } from "@/lib/shadow-dom";

export function outputCellIdFor(element: Element | null): string | null {
  let current: Element | null = element;
  while (current) {
    const cellId = cellIdsFor(current)[0] ?? null;
    if (cellId) return cellId;
    const parent = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }
    const root = current.getRootNode?.();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function scopedOutputCellIdFor(element: Element | null, targets: LensTarget[]): string | null {
  let current: Element | null = element;
  while (current) {
    const ids = cellIdsFor(current);
    for (const id of ids) {
      if (targets.some((target) => targetDisplayedInCell(target, id))) return id;
    }
    const parent = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }
    const root = current.getRootNode?.();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function cellIdsFor(element: Element): string[] {
  const ids: string[] = [];
  const id = element.getAttribute?.("id");
  const dataCellId = element.getAttribute?.("data-cell-id");
  if (id?.startsWith("output-")) ids.push(id.slice("output-".length));
  if (id?.startsWith("cell-"))
    ids.push(dataCellId && id === `cell-${dataCellId}` ? dataCellId : id.slice("cell-".length));
  if (dataCellId && isNotebookCellContainer(element)) ids.push(dataCellId);
  return [...new Set(ids)];
}

function isNotebookCellContainer(element: Element): boolean {
  if (element.hasAttribute("data-cell-name")) return true;
  if (element.getAttribute("draggable") === "true") return true;
  const testId = element.getAttribute("data-testid") ?? "";
  return testId.includes("cell");
}

export function targetDisplayedInCell(target: LensTarget, displayCellId: string): boolean {
  return target.cellId === displayCellId || (target.displayCellIds ?? []).includes(displayCellId);
}

export function selectionScopeFor(element: Element, targets: LensTarget[]): SelectionScope {
  const displayCellId = scopedOutputCellIdFor(element, targets) ?? outputCellIdFor(element);
  const displayTargets = displayCellId
    ? targets.filter((candidate) => targetDisplayedInCell(candidate, displayCellId))
    : [];
  return {
    allTargets: targets,
    targets: displayTargets.length > 0 ? displayTargets : targets,
    displayCellId,
    displayTargets,
  };
}

export function targetContext(target: LensTarget): Record<string, unknown> {
  return target.selectionPolicy?.context ?? {};
}

export function preferredSelectionRank(target: LensTarget, surface: SelectionSurface): number {
  const preferred = target.selectionPolicy?.prefer ?? [];
  const index = preferred.indexOf(surface);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

export function markedLensElement(element: Element): Element | null {
  return closestCrossingShadow(element, "[data-marimo-lens-var]");
}
