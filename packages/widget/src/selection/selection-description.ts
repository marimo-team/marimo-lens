import type { SelectionTarget, TargetInfo } from "@marimo-lens/protocol";

type DescribedSelection = { target: SelectionTarget; description: TargetInfo };

export function selectionTitle(selection: DescribedSelection): string {
  const { target, description } = selection;
  const lines: string[] = [];
  if (description.detail) lines.push(description.detail);
  if (description.renderSource) {
    const source = description.renderSource;
    lines.push(
      `Render source: ${source.path}${source.line ? `:${source.line}` : ""}${source.symbol ? ` (${source.symbol})` : ""}`,
    );
  }
  if (description.media) {
    const media = description.media;
    const span =
      media.start === undefined && media.end === undefined
        ? ""
        : `, ${media.start ?? 0} s to ${media.end === undefined ? "end" : `${media.end} s`}`;
    lines.push(`Media: ${media.path}${media.page ? `, page ${media.page}` : ""}${span}`);
  }
  if (target.kind === "notebook") lines.push(`Notebook cell ${target.cellIds[0]}`);
  else {
    lines.push(
      ...target.sources.map((source) => `${source.selector ?? "Output"} · Cell ${source.cellId}`),
    );
  }
  if (lines.length === 0) lines.push(description.label);
  return lines.join("\n");
}
