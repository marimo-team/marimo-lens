import type { CellActivityEvent, CellRevealEvent } from "@marimo-lens/protocol";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { CellAttentionController } from "@/transient/cell-attention";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cell attention", () => {
  test("marks activity without scrolling or mutating the target", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("BYtC");
    cell.scrollIntoView = vi.fn();
    const before = cell.outerHTML;
    const focused = document.createElement("button");
    document.body.appendChild(focused);
    focused.focus();

    controller.activity(activityEvent("BYtC", "Updating the aggregation."));

    expect(cell.scrollIntoView).not.toHaveBeenCalled();
    expect(cell.outerHTML).toBe(before);
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
    vi.advanceTimersByTime(2_200);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("holds a reveal for its requested duration", () => {
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
    const event = activityEvent("same", "Updating the chart.");

    controller.activity(event);
    const first = onChange.mock.lastCall?.[0];
    vi.advanceTimersByTime(19_000);
    controller.activity(event);
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

  test("updates a same-cell activity message and replaces activity with reveal", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("same");
    cell.scrollIntoView = vi.fn();

    controller.activity(activityEvent("same", "Editing."));
    const firstSequence = onChange.mock.lastCall?.[0].sequence;
    controller.activity(activityEvent("same", "Running."));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      kind: "activity",
      event: activityEvent("same", "Running."),
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
    const first = setupCell("first");
    const second = setupCell("second");

    controller.activity(activityEvent("first", "Editing."));
    vi.advanceTimersByTime(19_000);
    controller.activity(activityEvent("second", "Running."));
    vi.advanceTimersByTime(1_001);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "activity",
        event: activityEvent("second", "Running."),
        target: second,
      }),
    );
    expect(first.attributes).toHaveLength(1);
    expect(second.attributes).toHaveLength(1);
    controller.dispose();
  });

  test("attaches pending activity when its cell starts rendering", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    controller.activity(activityEvent("new-cell"));
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
    const replacement = setupCell("replaced");
    replacement.scrollIntoView = vi.fn();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: replacement }));
    expect(first.scrollIntoView).toHaveBeenCalledOnce();
    expect(replacement.scrollIntoView).not.toHaveBeenCalled();
    controller.dispose();
  });

  test("refreshes fixed attention when the exact cell resizes", () => {
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
    const controller = new CellAttentionController(new NotebookDomAdapter(document), onChange);
    controller.activity(activityEvent("resized"));
    const callsBeforeResize = onChange.mock.calls.length;

    for (const resize of resizeCallbacks) resize([], {} as ResizeObserver);

    expect(observe).toHaveBeenCalledWith(cell);
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
    controller.activity(activityEvent("removed"));

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
      controller.activity(activityEvent("hidden"));
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
    controller.activity(activityEvent("disposed"));

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
  cell.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);
  document.body.appendChild(cell);
  return cell;
}

function setupOutput(cellId: string): HTMLElement {
  const output = document.createElement("div");
  output.id = `output-${cellId}`;
  output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
  document.body.appendChild(output);
  return output;
}

function activityEvent(cellId: string, message?: string): CellActivityEvent {
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "cell.activity",
    revision: 7,
    payload: { cellId, ...(message ? { message } : {}) },
  };
}

function revealEvent(cellId: string, message?: string, durationMs?: number): CellRevealEvent {
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "cell.reveal",
    revision: 7,
    payload: {
      cellId,
      ...(message ? { message } : {}),
      ...(durationMs ? { durationMs } : {}),
    },
  };
}
