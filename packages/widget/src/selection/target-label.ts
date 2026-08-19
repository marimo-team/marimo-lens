import type { DomHint, SelectionTarget } from "@marimo-lens/protocol";

export function targetLabel(target: SelectionTarget, hint?: DomHint): string {
  if (target.kind === "notebook") return `Cell ${target.cellIds[0]}`;
  const tag = hint?.tag || "element";
  const text = hint?.ariaLabel || hint?.title || hint?.text;
  if (!text) return tag;
  const label = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return `${tag} “${label}”`;
}

export function targetTitle(target: SelectionTarget): string {
  if (target.kind === "notebook") return `Notebook output cell ${target.cellIds[0]}`;
  return `${target.documentPath} ${target.domSelector}`;
}
