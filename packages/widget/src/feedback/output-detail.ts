import type { PairFeedback, PairFeedbackAnnotation } from "@/types";

export type OutputDetailLevel = "compact" | "standard" | "detailed" | "forensic";

export const OUTPUT_DETAIL_OPTIONS: Array<{
  value: OutputDetailLevel;
  label: string;
  help: string;
}> = [
  {
    value: "compact",
    label: "Compact",
    help: "Smallest copy. Keeps requests, target names, and edit cells.",
  },
  {
    value: "standard",
    label: "Standard",
    help: "Balanced copy for most notebook edits. Omits large catalogs.",
  },
  {
    value: "detailed",
    label: "Detailed",
    help: "Adds cell previews, DOM evidence, groups, and selected target data.",
  },
  {
    value: "forensic",
    label: "Forensic",
    help: "Maximum detail. Copies the full marimo-pair packet.",
  },
];

const OUTPUT_DETAIL_VALUES = new Set<unknown>(OUTPUT_DETAIL_OPTIONS.map((option) => option.value));

export function isOutputDetailLevel(value: unknown): value is OutputDetailLevel {
  return OUTPUT_DETAIL_VALUES.has(value);
}

export function nextOutputDetailLevel(current: OutputDetailLevel): OutputDetailLevel {
  const index = OUTPUT_DETAIL_OPTIONS.findIndex((option) => option.value === current);
  return OUTPUT_DETAIL_OPTIONS[(index + 1) % OUTPUT_DETAIL_OPTIONS.length].value;
}

export function renderPairPromptForDetail(
  feedback: PairFeedback | null,
  detail: OutputDetailLevel,
  forensicPrompt: string,
  markdownFallback: string,
): string {
  if (detail === "forensic") return forensicPrompt || markdownFallback;
  if (!feedback || feedback.annotations.length === 0) {
    return markdownFallback || forensicPrompt;
  }

  const lines = basePromptLines(feedback, detail);
  if (detail === "compact") {
    appendCompactAnnotations(lines, feedback.annotations);
    return lines.join("\n").trim();
  }

  appendStandardAnnotations(lines, feedback.annotations, detail);
  if (detail === "detailed") {
    appendDetailedContext(lines, feedback);
  }
  appendJsonSubset(lines, feedback, detail);
  return lines.join("\n").trim();
}

function basePromptLines(feedback: PairFeedback, detail: OutputDetailLevel): string[] {
  const summary = feedback.summary as Record<string, unknown>;
  const targetCells = stringList(summary.targetCells);
  const filename = feedback.notebook?.filename || "running marimo notebook";
  const lines = [
    "# marimo-pair feedback",
    "",
    "Inspect the live marimo session before editing. Use `async with marimo._code_mode.get_context() as ctx:` and edit with `ctx.edit_cell(..., code=<full cell body>)`; do not patch the notebook file directly.",
    "",
    "Report progress through `marimo_lens.find_lens(required=False)` when available.",
    "",
    "## Summary",
    `- Detail: ${detail}`,
    `- Notebook: ${filename}`,
    `- Annotations: ${feedback.annotations.length}`,
  ];
  if (targetCells.length > 0) {
    lines.push(`- Target cells: ${targetCells.join(", ")}`);
  }
  lines.push("");
  return lines;
}

function appendCompactAnnotations(lines: string[], annotations: PairFeedbackAnnotation[]): void {
  lines.push("## Feedback");
  for (const annotation of annotations) {
    const cells = compactCells(annotation);
    const selection = selectionLabel(annotation);
    lines.push(
      `${annotation.index}. ${targetLabel(annotation)}${selection ? ` - ${selection}` : ""}`,
    );
    lines.push(`   Request: ${annotation.request}`);
    if (cells) lines.push(`   Cells: ${cells}`);
  }
}

function appendStandardAnnotations(
  lines: string[],
  annotations: PairFeedbackAnnotation[],
  detail: OutputDetailLevel,
): void {
  lines.push("## Feedback");
  for (const annotation of annotations) {
    lines.push(`### ${annotation.index}. ${targetLabel(annotation)}`);
    lines.push(`- Request: ${annotation.request}`);
    const cells = compactCells(annotation);
    if (cells) lines.push(`- Cells: ${cells}`);
    const selection = selectionLabel(annotation);
    if (selection) lines.push(`- Selection: ${selection}`);
    if (annotation.target.chartPart) {
      lines.push(`- Chart: ${chartPartLabel(annotation.target.chartPart)}`);
    }
    if (annotation.evidence.elementPath) {
      lines.push(`- DOM: ${truncateText(annotation.evidence.elementPath, 140)}`);
    }
    if (detail === "detailed") {
      appendCellPreviews(lines, annotation);
    }
    lines.push("");
  }
}

function appendCellPreviews(lines: string[], annotation: PairFeedbackAnnotation): void {
  const previews = annotation.cells.previews.slice(0, 4);
  for (const preview of previews) {
    const previewCode = truncateText(preview.codePreview, 360);
    if (!previewCode) continue;
    lines.push(`- Cell ${preview.id}: ${previewCode}`);
  }
}

function appendDetailedContext(lines: string[], feedback: PairFeedback): void {
  const controls = feedback.notebook?.controls?.summary;
  if (controls) {
    lines.push("## Runtime Context");
    lines.push(
      `- Controls: ${controls.uiElementCount ?? 0} UI, ${controls.widgetCount ?? 0} widgets, ${controls.traitletsObjectCount ?? 0} traitlets objects`,
    );
    if (controls.errorCount) lines.push(`- Control collection errors: ${controls.errorCount}`);
    lines.push("");
  }
}

function appendJsonSubset(
  lines: string[],
  feedback: PairFeedback,
  detail: Exclude<OutputDetailLevel, "compact" | "forensic">,
): void {
  const annotatedTargetIds = new Set(
    feedback.annotations.map((annotation) => annotation.target.id),
  );
  const subset = {
    protocol: feedback.protocol,
    version: feedback.version,
    generatedAt: feedback.generatedAt,
    source: feedback.source,
    contextPolicy: feedback.contextPolicy,
    summary: feedback.summary,
    groups: feedback.groups,
    displayProvenance: feedback.displayProvenance,
    targets:
      detail === "detailed"
        ? feedback.targets.filter((target) => annotatedTargetIds.has(target.id))
        : undefined,
    annotations: feedback.annotations.map((annotation) =>
      detail === "detailed" ? annotation : standardAnnotation(annotation),
    ),
  };
  lines.push("## Machine-readable subset");
  lines.push("```json");
  lines.push(JSON.stringify(removeUndefined(subset), null, 2));
  lines.push("```");
}

function standardAnnotation(annotation: PairFeedbackAnnotation) {
  return {
    id: annotation.id,
    index: annotation.index,
    request: annotation.request,
    target: {
      id: annotation.target.id,
      label: annotation.target.label,
      variable: annotation.target.variable,
      kind: annotation.target.kind,
      column: annotation.target.column,
      chartPart: annotation.target.chartPart,
    },
    cells: {
      editFocus: annotation.cells.editFocus,
      definition: annotation.cells.definition,
      display: annotation.cells.display,
      related: annotation.cells.related,
    },
    evidence: {
      element: annotation.evidence.element,
      elementPath: truncateText(annotation.evidence.elementPath, 180),
      semanticSelection: annotation.evidence.semanticSelection
        ? {
            kind: annotation.evidence.semanticSelection.kind,
            granularity: annotation.evidence.semanticSelection.granularity,
            label: annotation.evidence.semanticSelection.label,
            data: annotation.evidence.semanticSelection.data,
          }
        : null,
    },
    marimoPair: {
      readBeforeEdit: annotation.marimoPair.readBeforeEdit,
      runAfterEdit: annotation.marimoPair.runAfterEdit,
    },
  };
}

function compactCells(annotation: PairFeedbackAnnotation): string {
  const parts = [
    annotation.cells.editFocus ? `edit ${annotation.cells.editFocus}` : "",
    annotation.cells.display && annotation.cells.display !== annotation.cells.editFocus
      ? `display ${annotation.cells.display}`
      : "",
    ...annotation.cells.related
      .filter(
        (cellId: string) =>
          cellId !== annotation.cells.editFocus && cellId !== annotation.cells.display,
      )
      .slice(0, 4),
  ].filter(Boolean);
  return parts.join(", ");
}

function targetLabel(annotation: PairFeedbackAnnotation): string {
  const target = annotation.target;
  const variable = target.variable || target.label || target.id;
  const kind = target.kind ? ` (${target.kind})` : "";
  return `${variable}${kind}`;
}

function selectionLabel(annotation: PairFeedbackAnnotation): string {
  if (annotation.target.column) {
    const dtype = annotation.target.columnDtype ? `:${annotation.target.columnDtype}` : "";
    return `column ${annotation.target.column}${dtype}`;
  }
  if (annotation.target.chartPart) return chartPartLabel(annotation.target.chartPart);
  const selection = annotation.target.semanticSelection;
  if (selection) return `${selection.kind} ${selection.label}`.trim();
  return "";
}

function chartPartLabel(
  chartPart: NonNullable<PairFeedbackAnnotation["target"]["chartPart"]>,
): string {
  return [chartPart.library, chartPart.kind, chartPart.label].filter(Boolean).join(":");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function truncateText(value: string, maxLength: number): string {
  if (!value || value.length <= maxLength) return value;
  const ellipsis = "...";
  return `${value.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`;
}

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeUndefined) as T;
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => [key, removeUndefined(entryValue)]);
  return Object.fromEntries(entries) as T;
}
