import type { SelectionResolvedEvent } from "@marimo-lens/protocol";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { ResolutionReceipt } from "@/transient/resolution-receipt";

import { resolvedEventFixture, selectionFixture } from "../support/fixtures";
import { render } from "../support/render";

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolution receipt", () => {
  test("renders a quiet visual receipt outside the live region", () => {
    const event = resolvedEventFixture({ revision: 4, summary: "Updated the chart cell." });
    const onOpenHistory = vi.fn();
    renderReceipt(event, onOpenHistory);

    const receipt = document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]");
    expect(receipt?.textContent).toBe("S1AddressedUpdated the chart cell.");
    expect(receipt?.dataset.selectionId).toBe("selection-1");
    expect(receipt?.dataset.revision).toBe("4");
    expect(receipt?.getAttribute("aria-label")).toBe("Open history for S1");
    expect(receipt?.hasAttribute("aria-live")).toBe(false);
    receipt?.click();
    expect(onOpenHistory).toHaveBeenCalledWith(event);
  });

  test("summarizes one atomic batch", () => {
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const event = resolvedEventFixture({ revision: 6, selections: [selectionFixture(), second] });
    renderReceipt(event);

    const receipt = document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]");
    expect(receipt?.textContent).toBe("2 selectionsAddressed");
    expect(receipt?.dataset.selectionId).toBeUndefined();
    expect(receipt?.dataset.selectionCount).toBe("2");
    expect(receipt?.getAttribute("aria-label")).toBe("Open history for 2 selections");
  });
});

function renderReceipt(
  event: SelectionResolvedEvent,
  onOpenHistory: (event: SelectionResolvedEvent) => void = () => {},
) {
  render(<ResolutionReceipt event={event} onOpenHistory={onOpenHistory} />);
}
