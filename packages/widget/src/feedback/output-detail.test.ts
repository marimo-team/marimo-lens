import { describe, expect, test } from "vite-plus/test";

import { renderPairPromptForDetail } from "@/feedback/output-detail";
import { pairFeedback } from "@/feedback/pair-feedback-fixtures";

const FEEDBACK = pairFeedback();

describe("renderPairPromptForDetail", () => {
  test("compact output omits the JSON packet and keeps edit essentials", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "compact", "FULL PACKET", "");

    expect(prompt).toContain("Detail: compact");
    expect(prompt).toContain("Sort by revenue descending.");
    expect(prompt).toContain("Cells: edit cell-data, display cell-view");
    expect(prompt.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## Summary",
      "## Feedback",
    ]);
  });

  test("standard output includes a bounded machine-readable subset", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "standard", "FULL PACKET", "");

    expect(prompt).toContain("Detail: standard");
    expect(prompt).toContain("Machine-readable subset");
    const subset = machineSubset(prompt);
    expect(Object.keys(subset)).toEqual([
      "protocol",
      "version",
      "generatedAt",
      "source",
      "contextPolicy",
      "summary",
      "groups",
      "displayProvenance",
      "annotations",
    ]);
    expect(annotationTargetIds(subset)).toEqual(["var:sales"]);
  });

  test("detailed output adds selected targets and cell previews", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "detailed", "FULL PACKET", "");

    expect(prompt).toContain("Detail: detailed");
    expect(prompt).toContain("Controls: 2 UI, 1 widgets, 1 traitlets objects");
    expect(prompt).toContain("sales = pd.DataFrame");
    const subset = machineSubset(prompt);
    expect(targetIds(subset)).toEqual(["var:sales"]);
    expect(annotationTargetIds(subset)).toEqual(["var:sales"]);
  });

  test("forensic output preserves the full prompt", () => {
    expect(renderPairPromptForDetail(FEEDBACK, "forensic", "FULL PACKET", "")).toBe("FULL PACKET");
  });
});

function machineSubset(prompt: string): Record<string, unknown> {
  const match = /```json\n([\s\S]+?)\n```/.exec(prompt);
  if (!match?.[1]) throw new Error("Expected a machine-readable subset");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function targetIds(subset: Record<string, unknown>): string[] {
  return (subset.targets as Array<{ id: string }>).map((target) => target.id);
}

function annotationTargetIds(subset: Record<string, unknown>): string[] {
  return (subset.annotations as Array<{ target: { id: string } }>).map(
    (annotation) => annotation.target.id,
  );
}
