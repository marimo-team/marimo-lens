import type { LensTarget, NotebookGraph } from "@/types";

export type LineageSummary = {
  available: boolean;
  focusCellIds: string[];
  upstreamCellIds: string[];
  downstreamCellIds: string[];
};

export function lineageForTarget(
  target: LensTarget,
  graph: NotebookGraph,
  displayCellId?: string | null,
): LineageSummary {
  const focusCellIds = knownFocusCells(target, graph, displayCellId);
  if (!graph.available || !graph.edges?.length || focusCellIds.length === 0) {
    return {
      available: false,
      focusCellIds,
      upstreamCellIds: [],
      downstreamCellIds: [],
    };
  }

  const upstream = reachableCells(focusCellIds, graph.edges, "upstream");
  const downstream = reachableCells(focusCellIds, graph.edges, "downstream");
  const focus = new Set(focusCellIds);

  return {
    available: true,
    focusCellIds,
    upstreamCellIds: upstream.filter((cellId) => !focus.has(cellId)),
    downstreamCellIds: downstream.filter((cellId) => !focus.has(cellId)),
  };
}

function knownFocusCells(
  target: LensTarget,
  graph: NotebookGraph,
  displayCellId?: string | null,
): string[] {
  const knownCells = new Set(graph.cells?.map((cell) => cell.id) ?? []);
  const candidateGroups = [
    compactUnique([target.cellId]),
    compactUnique([displayCellId]),
    compactUnique(target.displayCellIds ?? []),
    compactUnique(target.relatedCellIds ?? []),
  ];
  for (const candidates of candidateGroups) {
    const knownCandidates = candidates.filter(
      (cellId) => knownCells.size === 0 || knownCells.has(cellId),
    );
    if (knownCandidates.length > 0) return knownCandidates;
  }
  return [];
}

function reachableCells(
  roots: string[],
  edges: NonNullable<NotebookGraph["edges"]>,
  direction: "upstream" | "downstream",
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === "downstream" ? edge.from : edge.to;
    const to = direction === "downstream" ? edge.to : edge.from;
    const next = adjacency.get(from);
    if (next) {
      next.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  }

  const visited = new Set<string>();
  const queue = [...roots];
  for (const root of roots) {
    visited.add(root);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return [...visited];
}

function compactUnique(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (value) unique.add(value);
  }
  return [...unique];
}
