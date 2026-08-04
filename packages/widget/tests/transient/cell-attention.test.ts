import type {
  CellActivityStartEvent,
  CellActivityStopEvent,
  CellRevealEvent,
} from "@marimo-lens/protocol";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { CellAttentionController } from "@/transient/cell-attention";
import { projectCellAttentionSurface } from "@/transient/cell-attention-indicator";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cell attention", () => {
  test("marks visible activity without scrolling or moving focus", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("BYtC");
    cell.scrollIntoView = vi.fn();
    const focused = document.createElement("button");
    document.body.appendChild(focused);
    focused.focus();

    controller.startActivity(startActivityEvent("BYtC", "Updating the aggregation."));

    expect(cell.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focused);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "activity",
        target: cell,
        phase: "active",
      }),
    );
    controller.dispose();
  });

  test("brings an offscreen activity target into view once", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("new-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();

    controller.startActivity(startActivityEvent("new-cell", "Building the requested chart."));

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
    controller.dispose();
  });

  test("does not restart offscreen activity framing on the initial resize observation", () => {
    vi.useFakeTimers();
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    const cell = setupCell("new-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), vi.fn());

    controller.startActivity(startActivityEvent("new-cell"));
    for (const resize of resizeCallbacks) resize([], {} as ResizeObserver);

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("shows fallback when offscreen activity framing settles without movement", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cell = setupCell("fixed-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);

    controller.startActivity(startActivityEvent("fixed-cell"));
    const pending = onChange.mock.lastCall?.[0];
    expect(projectCellAttentionSurface(pending, window)).toEqual({
      view: null,
      fallback: null,
    });

    vi.runOnlyPendingTimers();
    const settled = onChange.mock.lastCall?.[0];

    expect(projectCellAttentionSurface(settled, window)).toEqual({
      view: null,
      fallback: { presentation: settled, reason: "offscreen" },
    });
    controller.dispose();
  });

  test("reframes an activity target that has no room for its label", () => {
    vi.useFakeTimers();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), vi.fn());
    const cell = setupCell("near-top");
    cell.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);
    cell.scrollIntoView = vi.fn();

    controller.startActivity(startActivityEvent("near-top", "Checking the chart."));

    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
    controller.dispose();
  });

  test("reveals the exact cell once and expires after its exit", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("BYtC");
    cell.scrollIntoView = vi.fn();
    const output = setupOutput("BYtC");
    output.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("BYtC", "Updated the aggregation."));

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
    expect(output.scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("uses the duration carried by the reveal event", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("BYtC");
    cell.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("BYtC", "Read the verified result.", 8_000));

    vi.advanceTimersByTime(7_999);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "active" }));
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("keeps same-cell activity until another attention event replaces it", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("same");
    const event = startActivityEvent("same", "Updating the chart.");

    controller.startActivity(event);
    const first = onChange.mock.lastCall?.[0];
    vi.advanceTimersByTime(19_000);
    controller.startActivity(event);
    const renewed = onChange.mock.lastCall?.[0];

    expect(renewed.sequence).toBe(first.sequence);
    expect(renewed.expiresAt).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "activity",
        phase: "active",
      }),
    );
    controller.dispose();
  });

  test("expires timed activity after its hold and exit", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("timed");

    controller.startActivity(startActivityEvent("timed", "Checking the chart.", 8_000));

    vi.advanceTimersByTime(7_999);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "active" }));
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.advanceTimersByTime(120);
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("restarts a timed activity hold on the same cell", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("timed");
    const event = startActivityEvent("timed", "Checking the chart.", 4_000);

    controller.startActivity(event);
    vi.advanceTimersByTime(3_000);
    controller.startActivity(event);
    vi.advanceTimersByTime(3_999);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "active" }));
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    controller.dispose();
  });

  test("stops activity only for its active cell", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("working");

    controller.startActivity(startActivityEvent("working", "Updating the chart."));
    controller.stopActivity(activityStopEvent("other"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "activity" }));

    controller.stopActivity(activityStopEvent("working"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("updates a same-cell activity message and replaces activity with reveal", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("same");
    cell.scrollIntoView = vi.fn();

    controller.startActivity(startActivityEvent("same", "Editing."));
    const firstSequence = onChange.mock.lastCall?.[0].sequence;
    controller.startActivity(startActivityEvent("same", "Running."));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      kind: "activity",
      event: startActivityEvent("same", "Running."),
    });
    expect(onChange.mock.lastCall?.[0].sequence).toBeGreaterThan(firstSequence);

    controller.reveal(revealEvent("same", "Verified."));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      kind: "reveal",
      event: revealEvent("same", "Verified."),
    });
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("replaces activity when the primary working cell changes", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("first");
    const second = setupCell("second");

    controller.startActivity(startActivityEvent("first", "Editing."));
    vi.advanceTimersByTime(19_000);
    controller.startActivity(startActivityEvent("second", "Running."));
    vi.advanceTimersByTime(1_001);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "activity",
        event: startActivityEvent("second", "Running."),
        target: second,
      }),
    );
    controller.dispose();
  });

  test("attaches pending activity when its cell starts rendering", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    controller.startActivity(startActivityEvent("new-cell"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: null }));

    const cell = setupCell("new-cell");
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: cell }));
    controller.dispose();
  });

  test("re-resolves a replaced reveal target without scrolling again", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const first = setupCell("replaced");
    first.scrollIntoView = vi.fn();
    controller.reveal(revealEvent("replaced"));

    first.remove();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    const replacement = setupCell("replaced");
    replacement.scrollIntoView = vi.fn();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: replacement }));
    expect(first.scrollIntoView).toHaveBeenCalledOnce();
    expect(replacement.scrollIntoView).not.toHaveBeenCalled();
    controller.dispose();
  });

  test("updates reveal geometry after resize without scrolling again", () => {
    vi.useFakeTimers();
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    const cell = setupCell("resized-reveal");
    cell.scrollIntoView = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), vi.fn());

    controller.reveal(revealEvent("resized-reveal"));
    for (const resize of resizeCallbacks) resize([], {} as ResizeObserver);

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("frames an initially missing reveal once when its target appears", () => {
    vi.useFakeTimers();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), vi.fn());
    controller.reveal(revealEvent("late"));

    const cell = setupCell("late");
    cell.scrollIntoView = vi.fn();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("reframes activity after its cell grows beyond the viewport", () => {
    vi.useFakeTimers();
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const onChange = vi.fn();
    const cell = setupCell("resized");
    let rect = new DOMRect(20, 80, 400, 300);
    cell.getBoundingClientRect = () => rect;
    cell.scrollIntoView = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    controller.startActivity(startActivityEvent("resized"));
    const callsBeforeResize = onChange.mock.calls.length;
    expect(cell.scrollIntoView).not.toHaveBeenCalled();

    rect = new DOMRect(20, 120, 400, window.innerHeight - 100);

    for (const resize of resizeCallbacks) resize([], {} as ResizeObserver);

    expect(observe).toHaveBeenCalledWith(cell);
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.length).toBeGreaterThan(callsBeforeResize);
    controller.dispose();
    expect(disconnect).toHaveBeenCalled();
  });

  test("uses reduced motion on an output fallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const controller = new CellAttentionController(new NotebookDomAdapter(document), vi.fn());
    const output = setupOutput("fallback");
    output.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("fallback"));

    expect(output.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
    controller.dispose();
  });

  test("keeps activity through target removal and reattaches it", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("removed");
    controller.startActivity(startActivityEvent("removed"));

    cell.remove();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "activity", target: null }),
    );

    const replacement = setupCell("removed");
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "activity", target: replacement }),
    );
    controller.dispose();
  });

  test("keeps activity while its notebook document is hidden", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("hidden");
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      controller.startActivity(startActivityEvent("hidden"));
      vi.setSystemTime(Date.now() + 21_000);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "activity", target: expect.any(HTMLElement) }),
      );
    } finally {
      if (visibility) Object.defineProperty(document, "visibilityState", visibility);
      else Reflect.deleteProperty(document, "visibilityState");
      controller.dispose();
    }
  });

  test("uses the mounted notebook document", () => {
    vi.useFakeTimers();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const secondaryDocument = frame.contentDocument!;
    const primary = setupCell("shared");
    primary.scrollIntoView = vi.fn();
    const secondary = secondaryDocument.createElement("section");
    secondary.id = "cell-shared";
    secondary.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);
    secondary.scrollIntoView = vi.fn();
    secondaryDocument.body.appendChild(secondary);
    const controller = new CellAttentionController(
      new NotebookDomAdapter(secondaryDocument),
      vi.fn(),
    );

    controller.reveal(revealEvent("shared"));

    expect(secondary.scrollIntoView).toHaveBeenCalledOnce();
    expect(primary.scrollIntoView).not.toHaveBeenCalled();
    controller.dispose();
  });

  test("disposal clears the presentation and cancels later updates", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("disposed");
    controller.startActivity(startActivityEvent("disposed"));

    controller.dispose();
    const callsAfterDispose = onChange.mock.calls.length;
    expect(onChange).toHaveBeenLastCalledWith(null);

    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenCalledTimes(callsAfterDispose);
  });
});

function setupCell(cellId: string): HTMLElement {
  const cell = document.createElement("section");
  cell.id = `cell-${cellId}`;
  cell.getBoundingClientRect = () => new DOMRect(20, 80, 400, 300);
  document.body.appendChild(cell);
  return cell;
}

function setupOutput(cellId: string): HTMLElement {
  const output = document.createElement("div");
  output.id = `output-${cellId}`;
  output.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
  document.body.appendChild(output);
  return output;
}

function startActivityEvent(
  cellId: string,
  message?: string,
  durationMs?: number,
): CellActivityStartEvent {
  return {
    protocol: "marimo-lens.event",
    version: 2,
    type: "cell.activity.start",
    revision: 7,
    payload: {
      cellId,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(message ? { message } : {}),
    },
  };
}

function activityStopEvent(cellId: string): CellActivityStopEvent {
  return {
    protocol: "marimo-lens.event",
    version: 2,
    type: "cell.activity.stop",
    revision: 7,
    payload: { cellId },
  };
}

function revealEvent(cellId: string, message?: string, durationMs = 4_000): CellRevealEvent {
  return {
    protocol: "marimo-lens.event",
    version: 2,
    type: "cell.reveal",
    revision: 7,
    payload: {
      cellId,
      durationMs,
      ...(message ? { message } : {}),
    },
  };
}
