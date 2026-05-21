import { describe, expect, test } from "vitest";

import { renderPairPromptForDetail } from "@/feedback/output-detail";
import { pairFeedback } from "@/feedback/pair-feedback-fixtures";

const FEEDBACK = pairFeedback();

describe("renderPairPromptForDetail", () => {
  test("compact output omits the JSON packet and keeps edit essentials", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "compact", "FULL PACKET", "");

    expect(prompt).toContain("Detail: compact");
    expect(prompt).toContain("Sort by revenue descending.");
    expect(prompt).toContain("Cells: edit cell-data, display cell-view");
    expect(prompt).not.toContain("```json");
    expect(prompt).not.toContain("targetIndex");
  });

  test("standard output includes a bounded machine-readable subset", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "standard", "FULL PACKET", "");

    expect(prompt).toContain("Detail: standard");
    expect(prompt).toContain("Machine-readable subset");
    expect(prompt).toContain('"annotations"');
    expect(prompt).not.toContain('"targets"');
    expect(prompt).not.toContain("unrelated");
  });

  test("detailed output adds selected targets and cell previews", () => {
    const prompt = renderPairPromptForDetail(FEEDBACK, "detailed", "FULL PACKET", "");

    expect(prompt).toContain("Detail: detailed");
    expect(prompt).toContain("Controls: 2 UI, 1 widgets, 1 traitlets objects");
    expect(prompt).toContain("sales = pd.DataFrame");
    expect(prompt).toContain('"targets"');
    expect(prompt).not.toContain("unrelated");
  });

  test("forensic output preserves the full prompt", () => {
    expect(renderPairPromptForDetail(FEEDBACK, "forensic", "FULL PACKET", "")).toBe("FULL PACKET");
  });
});
