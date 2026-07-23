import type { SelectionResolvedEvent } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { ResolutionReceipt } from "@/transient/resolution-receipt";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("resolution receipt", () => {
  test("renders a quiet visual receipt outside the live region", () => {
    const event: SelectionResolvedEvent = {
      protocol: "marimo-lens.event",
      version: 1,
      type: "selection.resolved",
      revision: 4,
      payload: {
        selections: [
          {
            selectionId: "selection-1",
            label: "S1",
            resolutionRevision: 4,
          },
        ],
        summary: "Updated the chart cell.",
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onOpenHistory = vi.fn();
    act(() => root?.render(<ResolutionReceipt event={event} onOpenHistory={onOpenHistory} />));

    const receipt = document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]");
    expect(receipt?.textContent).toBe("S1AddressedUpdated the chart cell.");
    expect(receipt?.dataset.selectionId).toBe("selection-1");
    expect(receipt?.dataset.revision).toBe("4");
    expect(receipt?.getAttribute("aria-label")).toBe("Open history for S1");
    expect(receipt?.hasAttribute("aria-live")).toBe(false);
    act(() => receipt?.click());
    expect(onOpenHistory).toHaveBeenCalledWith(event);
  });

  test("summarizes one atomic batch", () => {
    const event: SelectionResolvedEvent = {
      protocol: "marimo-lens.event",
      version: 1,
      type: "selection.resolved",
      revision: 6,
      payload: {
        selections: [
          {
            selectionId: "selection-1",
            label: "S1",
            resolutionRevision: 6,
          },
          {
            selectionId: "selection-2",
            label: "S2",
            resolutionRevision: 6,
          },
        ],
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<ResolutionReceipt event={event} onOpenHistory={() => {}} />));

    const receipt = document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]");
    expect(receipt?.textContent).toBe("2 selectionsAddressed");
    expect(receipt?.dataset.selectionId).toBeUndefined();
    expect(receipt?.dataset.selectionCount).toBe("2");
    expect(receipt?.getAttribute("aria-label")).toBe("Open history for 2 selections");
  });
});
