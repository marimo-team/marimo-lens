import type { LensTarget, NotebookGraph } from "@/types";

import { cellElement, isUsableRegion } from "@/lib/cell-regions";
import { targetName } from "@/lib/target-labels";

type GraphCell = NonNullable<NotebookGraph["cells"]>[number];

type MeasuredCell = {
  id: string;
  graphIndex: number;
  rect: DOMRect;
};

type ColumnBucket = {
  left: number;
  right: number;
  width: number;
  cells: MeasuredCell[];
};

export function orderedTargets(targets: LensTarget[], graph: NotebookGraph): LensTarget[] {
  const cellRanks = notebookCellRanks(graph);
  const outputRanks = notebookOutputRanks(graph);
  const originalIndices = new Map(targets.map((target, index) => [target.id, index]));

  return targets.toSorted((left, right) => {
    const leftCellRank = targetCellRank(left, cellRanks);
    const rightCellRank = targetCellRank(right, cellRanks);
    if (leftCellRank !== rightCellRank) return leftCellRank - rightCellRank;

    const leftOutputRank = targetOutputRank(left, outputRanks);
    const rightOutputRank = targetOutputRank(right, outputRanks);
    if (leftOutputRank !== rightOutputRank) return leftOutputRank - rightOutputRank;

    const leftIndex = originalIndices.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = originalIndices.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;

    return targetName(left).localeCompare(targetName(right));
  });
}

function notebookCellRanks(graph: NotebookGraph): Map<string, number> {
  const graphCellIds = graphOrderedCellIds(graph);
  const layoutCellIds = measuredLayoutCellIds(graphCellIds);
  const orderedCellIds = layoutCellIds.length > 0 ? layoutCellIds : graphCellIds;
  return new Map(orderedCellIds.map((cellId, index) => [cellId, index]));
}

function graphOrderedCellIds(graph: NotebookGraph): string[] {
  if (graph.cells?.length) return graph.cells.map((cell) => cell.id);
  return topologicallySortedCellIds(graph.edges ?? []);
}

function topologicallySortedCellIds(edges: NonNullable<NotebookGraph["edges"]>): string[] {
  const cellIds: string[] = [];
  const seen = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const indegrees = new Map<string, number>();

  const trackCell = (cellId: string) => {
    if (seen.has(cellId)) return;
    seen.add(cellId);
    cellIds.push(cellId);
    indegrees.set(cellId, indegrees.get(cellId) ?? 0);
  };

  for (const edge of edges) {
    trackCell(edge.from);
    trackCell(edge.to);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    indegrees.set(edge.to, (indegrees.get(edge.to) ?? 0) + 1);
  }

  const queue = cellIds.filter((cellId) => (indegrees.get(cellId) ?? 0) === 0);
  const sorted: string[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const cellId = queue[index];
    sorted.push(cellId);
    for (const childId of outgoing.get(cellId) ?? []) {
      const nextIndegree = (indegrees.get(childId) ?? 0) - 1;
      indegrees.set(childId, nextIndegree);
      if (nextIndegree === 0) queue.push(childId);
    }
  }

  if (sorted.length === cellIds.length) return sorted;
  const sortedSet = new Set(sorted);
  return [...sorted, ...cellIds.filter((cellId) => !sortedSet.has(cellId))];
}

function measuredLayoutCellIds(graphCellIds: string[]): string[] {
  if (typeof document === "undefined") return [];

  const measured = graphCellIds.flatMap((cellId, graphIndex): MeasuredCell[] => {
    const element = cellElement(cellId, "cell");
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    if (!isUsableRegion(rect)) return [];
    return [{ id: cellId, graphIndex, rect }];
  });
  if (measured.length === 0) return [];

  const measuredIds = new Set(measured.map((cell) => cell.id));
  const remainingCellIds = graphCellIds.filter((cellId) => !measuredIds.has(cellId));
  return [...columnMajorCellIds(measured), ...remainingCellIds];
}

function columnMajorCellIds(cells: MeasuredCell[]): string[] {
  const columns: ColumnBucket[] = [];

  for (const cell of cells.toSorted(
    (left, right) =>
      left.rect.left - right.rect.left ||
      left.rect.top - right.rect.top ||
      left.graphIndex - right.graphIndex,
  )) {
    const column = matchingColumn(cell, columns);
    if (column) {
      column.left = Math.min(column.left, cell.rect.left);
      column.right = Math.max(column.right, cell.rect.right);
      column.width = Math.max(column.width, column.right - column.left);
      column.cells.push(cell);
    } else {
      columns.push({
        left: cell.rect.left,
        right: cell.rect.right,
        width: cell.rect.width,
        cells: [cell],
      });
    }
  }

  return columns
    .toSorted((left, right) => left.left - right.left)
    .flatMap((column) =>
      column.cells
        .toSorted(
          (left, right) =>
            left.rect.top - right.rect.top ||
            left.rect.left - right.rect.left ||
            left.graphIndex - right.graphIndex,
        )
        .map((cell) => cell.id),
    );
}

function matchingColumn(cell: MeasuredCell, columns: ColumnBucket[]): ColumnBucket | null {
  for (const column of columns) {
    if (belongsToColumn(cell, column)) return column;
  }
  return null;
}

function belongsToColumn(cell: MeasuredCell, column: ColumnBucket): boolean {
  const overlap = Math.min(cell.rect.right, column.right) - Math.max(cell.rect.left, column.left);
  const minWidth = Math.min(cell.rect.width, column.width);
  const leftDelta = Math.abs(cell.rect.left - column.left);
  return overlap >= minWidth * 0.35 || leftDelta <= 36;
}

function notebookOutputRanks(graph: NotebookGraph): Map<string, Map<string, number>> {
  const ranks = new Map<string, Map<string, number>>();
  for (const cell of graph.cells ?? []) {
    const cellOutputRanks = outputRanksForCell(cell);
    if (cellOutputRanks.size > 0) ranks.set(cell.id, cellOutputRanks);
  }
  return ranks;
}

function outputRanksForCell(cell: GraphCell): Map<string, number> {
  return new Map((cell.outputRefs ?? []).map((name, index) => [name, index]));
}

function targetCellRank(target: LensTarget, cellRanks: Map<string, number>): number {
  for (const group of targetCellIdGroups(target)) {
    let bestRank = Number.MAX_SAFE_INTEGER;
    for (const cellId of group) {
      const rank = cellRanks.get(cellId);
      if (typeof rank === "number") bestRank = Math.min(bestRank, rank);
    }
    if (bestRank !== Number.MAX_SAFE_INTEGER) return bestRank;
  }
  return Number.MAX_SAFE_INTEGER;
}

function targetOutputRank(
  target: LensTarget,
  outputRanks: Map<string, Map<string, number>>,
): number {
  const outputKeys = [
    target.variable,
    target.label,
    ...((target.outputRefs ?? []) as string[]),
  ].filter((key): key is string => Boolean(key));
  if (outputKeys.length === 0) return Number.MAX_SAFE_INTEGER;

  for (const group of targetCellIdGroups(target)) {
    for (const cellId of group) {
      const ranks = outputRanks.get(cellId);
      if (!ranks) continue;
      for (const outputKey of outputKeys) {
        const rank = ranks.get(outputKey);
        if (typeof rank === "number") return rank;
      }
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function targetCellIdGroups(target: LensTarget): string[][] {
  return [
    compactCellIds(target.displayCellIds ?? []),
    compactCellIds([target.output?.cellId, target.cellId]),
    compactCellIds(target.relatedCellIds ?? []),
  ].filter((group) => group.length > 0);
}

function compactCellIds(cellIds: Array<string | null | undefined>): string[] {
  return [...new Set(cellIds.filter((cellId): cellId is string => Boolean(cellId)))];
}
