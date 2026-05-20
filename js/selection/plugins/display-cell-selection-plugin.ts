import { queryFirstCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

export const displayCellSelectionPlugin = defineSelectionPlugin({
  id: "display-cell",
  surface: "display-cell",
  priority: 700,
  select: ({ displayCellId, displayTargets, element }) => {
    if (!displayCellId) return null;
    const target = displayCellTarget(displayTargets);
    if (!target) return null;
    const cellElement = elementForCellId(displayCellId) ?? element;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        element: cellElement,
        sourceElement: element,
        kind: target.kind === "output" ? "output" : "target",
        granularity: "target",
        hitKind: "display-cell",
        highlight: {
          kind: "element",
          element: cellElement,
          strategy: "display-cell",
        },
        data: {
          surface: "marimo-output-cell",
          displayCellId,
        },
      }),
      displayCellId,
      score: 64,
    };
  },
  previewElement: ({ target }) => {
    for (const cellId of targetPreviewCellIds(target)) {
      const element = elementForCellId(cellId);
      if (element) return element;
    }
    return null;
  },
});

function displayCellTarget<T extends { kind: string }>(targets: T[]): T | null {
  if (targets.length === 1) return targets[0];
  const outputTargets = targets.filter((target) => target.kind === "output");
  return outputTargets.length === 1 ? outputTargets[0] : null;
}

function targetPreviewCellIds(target: {
  cellId?: string | null;
  displayCellIds?: string[];
}): string[] {
  return [...new Set([...(target.displayCellIds ?? []), target.cellId].filter(isString))];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function elementForCellId(cellId: string): Element | null {
  const escaped = cssEscape(cellId);
  return queryFirstCrossingShadow(
    document,
    `[id="output-${escaped}"],[id="cell-${escaped}"],[id="${escaped}"],[data-cell-id="${escaped}"]`,
  );
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/["\\]/g, "\\$&");
}
