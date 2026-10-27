import type { HistoryEntry, SelectionTarget } from "@marimo-lens/protocol";

import { targetInDocument } from "@/notebook/document-identity";

/**
 * Return the target a History entry reopens in `ownerDocument`, or null for a
 * chat request or a selection whose cell is gone. Python follows each recorded
 * cell to the notebook now, and `entry.cellIds` lists the cells it found.
 */
export function reopenTarget(entry: HistoryEntry, ownerDocument: Document): SelectionTarget | null {
  const target = entry.selection?.target;
  if (!target) return null;
  const found = new Set(entry.cellIds);
  if (!target.cellIds.every((cellId) => found.has(cellId))) return null;
  return targetInDocument(target, ownerDocument);
}
