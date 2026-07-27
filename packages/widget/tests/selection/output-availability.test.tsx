import type { Selection } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { SelectionList } from "@/selection/components/selection-list";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import { useAvailableOutputCellIds } from "@/selection/output-availability";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

import { selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";

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

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilityProbe selections={[]} />
        </NotebookDomTestProvider>,
      ),
    );
    expect(MutationObserverStub).not.toHaveBeenCalled();

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilityProbe selections={[selectionFixture()]} />
        </NotebookDomTestProvider>,
      ),
    );
    expect(MutationObserverStub).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(document.body, {
      childList: true,
      subtree: true,
    });

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

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilityProbe selections={[]} />
        </NotebookDomTestProvider>,
      ),
    );
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

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilitySurface selection={selection} />
        </NotebookDomTestProvider>,
      ),
    );
    expect(marker(selection)).not.toBeNull();
    expect(
      document.querySelector('.ml-selection-list__details [aria-label="Point selection"]'),
    ).not.toBeNull();
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

  test("reattaches when ResizeObserver reports visible output dimensions", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
    let notifyResize: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const selection = selectionFixture();
    let width = 0;
    const output = setupOutput(selection.outputCellId);
    output.getBoundingClientRect = () => new DOMRect(20, 20, width, 240);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilityProbe selections={[selection]} />
        </NotebookDomTestProvider>,
      ),
    );
    expect(container.textContent).toBe("0");

    await act(async () => {
      width = 400;
      notifyResize?.([], {} as ResizeObserver);
      await new Promise((resolve) => window.setTimeout(resolve, 5));
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
  const snapshotLoader = new SelectionSnapshotLoader(async () => {
    throw new Error("Snapshot loading is not expected in this test");
  });
  return (
    <>
      <SelectionList
        selections={selections}
        currentSelectionId={selection.id}
        availableOutputCellIds={availableOutputCellIds}
        capturingSelectionIds={new Set()}
        busySelectionIds={new Set()}
        clearing={false}
        onActivate={() => {}}
        onEditNote={() => {}}
        onDelete={() => {}}
        onClear={() => {}}
        snapshotLoader={snapshotLoader}
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
