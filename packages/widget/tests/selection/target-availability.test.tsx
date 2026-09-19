import type { Selection } from "@marimo-lens/protocol";

import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { documentIdentity } from "@/notebook/selection-target";
import { SelectionList } from "@/selection/components/selection-list";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { useAvailableSelectionIds } from "@/selection/target-availability";

import { selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";

let root: Root | null = null;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("target availability", () => {
  test("subscribes while selections exist and releases the subscription when cleared", () => {
    const release = vi.fn();
    const subscribe = vi
      .spyOn(NotebookDomAdapter.prototype, "subscribeLayout")
      .mockReturnValue(release);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (selections: Selection[]) =>
      act(() =>
        root?.render(
          <NotebookDomTestProvider>
            <AvailabilityProbe selections={selections} />
          </NotebookDomTestProvider>,
        ),
      );
    render([]);
    expect(subscribe).not.toHaveBeenCalled();
    render([selectionFixture()]);
    expect(subscribe).toHaveBeenCalledOnce();
    render([]);
    expect(release).toHaveBeenCalledOnce();
  });

  test("updates all selections on one output while preserving other targets", async () => {
    const commit = vi.fn();
    const first = selectionFixture();
    const second = selectionFixture({ id: "second", label: "S2" });
    const other = selectionFixture({
      id: "other",
      label: "S3",
      target: { ...first.target, cellIds: ["other-cell"] },
    });
    const output = setupOutput(first.target.cellIds[0]!);
    setupOutput("other-cell");
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <Profiler id="availability" onRender={commit}>
            <AvailabilityProbe selections={[first, second, other]} />
          </Profiler>
        </NotebookDomTestProvider>,
      ),
    );
    expect(container.textContent).toBe("3");
    const commits = commit.mock.calls.length;
    await mutateDocument(() => {
      output.textContent = "Streaming output";
    });
    expect(commit).toHaveBeenCalledTimes(commits);
    await mutateDocument(() => output.remove());
    expect(container.textContent).toBe("1");
    await mutateDocument(() => document.body.append(output));
    expect(container.textContent).toBe("3");
  });

  test("detaches when its exact output disappears and reattaches only to the same cell id", async () => {
    const selection = selectionFixture();
    const output = setupOutput(selection.target.cellIds[0]!);
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
    expect(document.querySelector("[data-marimo-lens-target-unavailable]")).toBeNull();

    await mutateDocument(() => output.remove());
    expect(marker(selection)).toBeNull();
    expect(document.querySelector("[data-marimo-lens-target-unavailable]")?.textContent).toBe(
      "Target unavailable",
    );

    await mutateDocument(() => setupOutput("another-cell"));
    expect(marker(selection)).toBeNull();
    expect(document.querySelector("[data-marimo-lens-target-unavailable]")?.textContent).toBe(
      "Target unavailable",
    );

    await mutateDocument(() => setupOutput(selection.target.cellIds[0]!));
    expect(marker(selection)?.textContent).toBe(selection.label);
    expect(document.querySelector("[data-marimo-lens-target-unavailable]")).toBeNull();
  });

  test("reattaches when ResizeObserver reports visible output dimensions", async () => {
    const resizeObservers: TestResizeObserver[] = [];
    class TestResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObservers.push(this);
      }

      observe(_target: Element, _options?: ResizeObserverOptions) {}
      unobserve(_target: Element) {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const selection = selectionFixture();
    let width = 0;
    const output = setupOutput(selection.target.cellIds[0]!);
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
      const activeResizeObserver = resizeObservers[0];
      if (!activeResizeObserver) {
        throw new Error("Resize observer fixture must be connected");
      }
      activeResizeObserver.callback([], activeResizeObserver);
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });
    expect(container.textContent).toBe("1");
  });

  test("updates configured target availability after producer metadata changes", async () => {
    const target = document.createElement("section");
    target.id = "summary";
    target.dataset.marimoLensCellId = "cell-1";
    target.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(target);
    const selection = selectionFixture({
      target: {
        kind: "dom",
        sources: [{ cellId: "cell-1", selector: null }],
        cellIds: ["cell-1"],
        documentId: documentIdentity(document),
        documentPath: "/",
        domSelector: "#summary",
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <NotebookDomTestProvider>
          <AvailabilityProbe selections={[selection]} selector="#summary" />
        </NotebookDomTestProvider>,
      ),
    );
    expect(container.textContent).toBe("1");

    await mutateDocument(() => {
      target.dataset.marimoLensCellId = "cell-2";
    });
    expect(container.textContent).toBe("0");
  });
});

function AvailabilityProbe({
  selections,
  selector = null,
}: {
  selections: Selection[];
  selector?: string | null;
}) {
  const available = useAvailableSelectionIds(selections, selector);
  return <span>{available.size}</span>;
}

function AvailabilitySurface({ selection }: { selection: Selection }) {
  const selections = [selection];
  const availableSelectionIds = useAvailableSelectionIds(selections, null);
  const snapshotLoader = new SelectionSnapshotLoader(async () => {
    throw new Error("Snapshot loading is not expected in this test");
  });
  return (
    <>
      <SelectionList
        selections={selections}
        currentSelectionId={selection.id}
        availableSelectionIds={availableSelectionIds}
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
        availableSelectionIds={availableSelectionIds}
        selector={null}
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
    await Promise.resolve();
    vi.advanceTimersToNextFrame();
  });
}

function marker(selection: Selection): HTMLButtonElement | null {
  return document.querySelector(`[data-marimo-lens-selection-id="${selection.id}"]`);
}
