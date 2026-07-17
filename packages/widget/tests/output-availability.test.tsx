import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { Selection } from "@/contracts";

import { SelectionList } from "@/components/selection-list";
import { SelectionOverlay } from "@/components/selection-overlay";
import { useAvailableOutputCellIds } from "@/output-availability";

import { selectionFixture } from "./test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("output availability", () => {
  test("observes the document only while selections reference outputs", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const requestAnimationFrame = vi.fn(() => 1);
    let notify: MutationCallback | null = null;
    const MutationObserverStub = vi.fn(
      class {
        constructor(callback: MutationCallback) {
          notify = callback;
        }

        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("MutationObserver", MutationObserverStub);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<AvailabilityProbe selections={[]} />));
    expect(MutationObserverStub).not.toHaveBeenCalled();

    act(() => root?.render(<AvailabilityProbe selections={[selectionFixture()]} />));
    expect(MutationObserverStub).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(document.body, { childList: true, subtree: true });

    const output = setupOutput("cell-1");
    const record = {
      target: document.body,
      addedNodes: [output],
      removedNodes: [],
    } as unknown as MutationRecord;
    act(() => {
      notify?.([record], {} as MutationObserver);
      notify?.([record], {} as MutationObserver);
    });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    act(() => root?.render(<AvailabilityProbe selections={[]} />));
    expect(disconnect).toHaveBeenCalledOnce();
  });

  test("detaches when its exact output disappears and reattaches only to the same cell id", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));

    const selection = selectionFixture();
    const output = setupOutput(selection.outputCellId);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<AvailabilitySurface selection={selection} />));
    expect(marker(selection)).not.toBeNull();
    expect(document.querySelector(".ml-selection-list__availability")).toBeNull();

    await mutateDocument(() => output.remove());
    expect(marker(selection)).toBeNull();
    expect(document.querySelector(".ml-selection-list__availability")?.textContent).toBe(
      "Output unavailable",
    );

    await mutateDocument(() => setupOutput("another-cell"));
    expect(marker(selection)).toBeNull();
    expect(document.querySelector(".ml-selection-list__availability")?.textContent).toBe(
      "Output unavailable",
    );

    await mutateDocument(() => setupOutput(selection.outputCellId));
    expect(marker(selection)?.textContent).toBe(selection.label);
    expect(document.querySelector(".ml-selection-list__availability")).toBeNull();
  });

  test("reattaches when an existing output gains visible content", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));

    const selection = selectionFixture();
    let width = 0;
    const output = setupOutput(selection.outputCellId);
    output.getBoundingClientRect = () => new DOMRect(20, 20, width, 240);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<AvailabilityProbe selections={[selection]} />));
    expect(container.textContent).toBe("0");

    await mutateDocument(() => {
      width = 400;
      output.appendChild(document.createElement("span"));
    });
    expect(container.textContent).toBe("1");
  });
});

function AvailabilityProbe({ selections }: { selections: Selection[] }) {
  const available = useAvailableOutputCellIds(selections);
  return <span>{available.size}</span>;
}

function AvailabilitySurface({ selection }: { selection: Selection }) {
  const selections = [selection];
  const availableOutputCellIds = useAvailableOutputCellIds(selections);
  return (
    <>
      <SelectionList
        selections={selections}
        currentSelectionId={selection.id}
        availableOutputCellIds={availableOutputCellIds}
        capturingSelectionIds={new Set()}
        busySelectionIds={new Set()}
        clearing={false}
        onClose={() => {}}
        onActivate={() => {}}
        onEditNote={() => {}}
        onDelete={() => {}}
        onClear={() => {}}
        loadSnapshot={async () => {
          throw new Error("Snapshot loading is not expected in this test");
        }}
      />
      <SelectionOverlay
        selections={selections}
        currentSelectionId={selection.id}
        availableOutputCellIds={availableOutputCellIds}
        workflow={{ mode: "idle" }}
        busySelectionIds={new Set()}
        capturingSelectionIds={new Set()}
        onActivate={() => {}}
        onEditNote={() => {}}
        onDelete={() => {}}
        loadSnapshot={async () => {
          throw new Error("Snapshot loading is not expected in this test");
        }}
        onReposition={() => {}}
        registerAdjustment={() => {}}
        releaseAdjustment={() => {}}
      />
    </>
  );
}

function setupOutput(outputCellId: string): HTMLElement {
  const output = document.createElement("div");
  output.id = `output-${outputCellId}`;
  output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 240 },
  });
  document.body.appendChild(output);
  return output;
}

async function mutateDocument(mutation: () => void): Promise<void> {
  await act(async () => {
    mutation();
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  });
}

function marker(selection: Selection): HTMLButtonElement | null {
  return document.querySelector(`[data-marimo-lens-selection-id="${selection.id}"]`);
}
