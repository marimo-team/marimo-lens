import type { Selection } from "@marimo-lens/protocol";

import { act, Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { SelectionList } from "@/dock/selection-list";
import { documentIdentity } from "@/notebook/document-identity";
import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import { useAvailableSelectionIds } from "@/selection/target-availability";

import { outputFixture, selectionFixture } from "../support/fixtures";
import { LensTestProvider, lensState } from "../support/lens";
import { NotebookDomTestProvider } from "../support/notebook-dom";
import { render } from "../support/render";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
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
    const probe = (selections: Selection[]) => (
      <NotebookDomTestProvider>
        <AvailabilityProbe selections={selections} />
      </NotebookDomTestProvider>
    );
    const { rerender } = render(probe([]));
    expect(subscribe).not.toHaveBeenCalled();
    rerender(probe([selectionFixture()]));
    expect(subscribe).toHaveBeenCalledOnce();
    rerender(probe([]));
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
    const { container } = render(
      <NotebookDomTestProvider>
        <Profiler id="availability" onRender={commit}>
          <AvailabilityProbe selections={[first, second, other]} />
        </Profiler>
      </NotebookDomTestProvider>,
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
    render(
      <NotebookDomTestProvider>
        <AvailabilitySurface selection={selection} />
      </NotebookDomTestProvider>,
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
    const { container } = render(
      <NotebookDomTestProvider>
        <AvailabilityProbe selections={[selection]} />
      </NotebookDomTestProvider>,
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
    const { container } = render(
      <NotebookDomTestProvider selector="#summary">
        <AvailabilityProbe selections={[selection]} />
      </NotebookDomTestProvider>,
    );
    expect(container.textContent).toBe("1");

    await mutateDocument(() => {
      target.dataset.marimoLensCellId = "cell-2";
    });
    expect(container.textContent).toBe("0");
  });
});

function AvailabilityProbe({ selections }: { selections: Selection[] }) {
  const available = useAvailableSelectionIds(selections);
  return <span>{available.size}</span>;
}

function AvailabilitySurface({ selection }: { selection: Selection }) {
  const selections = [selection];
  const availableSelectionIds = useAvailableSelectionIds(selections);
  return (
    <>
      <LensTestProvider
        state={lensState({ selections, currentSelectionId: selection.id, availableSelectionIds })}
      >
        <SelectionList />
      </LensTestProvider>
      <SelectionOverlay
        selections={selections}
        currentSelectionId={selection.id}
        workflow={{ mode: "idle" }}
        busySelectionIds={new Set()}
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
  return outputFixture(outputCellId, new DOMRect(20, 20, 400, 240));
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
