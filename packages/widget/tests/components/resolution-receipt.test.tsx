import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";

import type { SelectionResolvedEvent } from "@/contracts";

import { ResolutionReceipt } from "@/components/resolution-receipt";

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
        selectionId: "selection-1",
        label: "S1",
        summary: "Updated the chart cell.",
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<ResolutionReceipt event={event} />));

    const receipt = document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]");
    expect(receipt?.textContent).toBe("S1resolvedUpdated the chart cell.");
    expect(receipt?.dataset.selectionId).toBe("selection-1");
    expect(receipt?.dataset.revision).toBe("4");
    expect(receipt?.getAttribute("aria-hidden")).toBe("true");
    expect(receipt?.hasAttribute("aria-live")).toBe(false);
    expect(receipt?.querySelector("button, a, input, [tabindex]")).toBeNull();
  });
});
