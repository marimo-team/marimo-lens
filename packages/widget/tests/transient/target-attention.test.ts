import type {
  AttentionActivityStartEvent,
  AttentionActivityStopEvent,
  AttentionRevealEvent,
} from "@marimo-lens/protocol";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import {
  TargetAttentionController,
  type TargetAttentionPresentation,
  type TargetLocator,
} from "@/transient/target-attention";
import { projectTargetAttentionSurface } from "@/transient/target-attention-indicator";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("target attention", () => {
  test("obsolete Trail controls cannot replace newer attention", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("first").scrollIntoView = vi.fn();
    const second = setupCell("second");
    second.scrollIntoView = vi.fn();
    controller.reveal({
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.reveal",
      payload: {
        id: "trail-1",
        steps: [
          { address: { kind: "cell", cellId: "first" }, label: "Question" },
          { address: { kind: "cell", cellId: "second" }, label: "Answer" },
        ],
      },
    });
    const navigation = onChange.mock.lastCall?.[0].trail;
    controller.reveal({
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.reveal",
      payload: {
        id: "current",
        steps: [{ address: { kind: "cell", cellId: "second" }, label: "Current result" }],
      },
    });
    navigation.next();
    navigation.close();
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ target: second, trail: { id: "current" } });
    controller.reveal(revealEvent("second", "New work"));
    navigation.next();
    navigation.close();
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ target: second, message: "New work" });
    expect(onChange.mock.lastCall?.[0].trail).toBeUndefined();
    controller.dispose();
  });

  test("navigation shares one reveal deadline and expired controls cannot revive it", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("first").scrollIntoView = vi.fn();
    setupCell("second").scrollIntoView = vi.fn();
    controller.reveal({
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.reveal",
      payload: {
        id: "timed",
        durationMs: 4_000,
        steps: [
          { address: { kind: "cell", cellId: "first" } },
          { address: { kind: "cell", cellId: "second" } },
        ],
      },
    });
    const first = onChange.mock.lastCall?.[0];
    vi.advanceTimersByTime(3_000);
    first.trail.next();
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      expiresAt: first.expiresAt,
      locator: { label: "second" },
    });
    vi.advanceTimersByTime(1_000);
    expect(onChange.mock.lastCall?.[0].phase).toBe("exiting");
    first.trail.previous();
    expect(onChange.mock.lastCall?.[0].phase).toBe("exiting");
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith(null);
    first.trail.next();
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("does not publish a reveal whose lifetime elapsed while framing its target", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("slow").scrollIntoView = () => vi.setSystemTime(Date.now() + 200);
    controller.reveal(revealEvent("slow", "Brief result", 1));
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("smoothly frames distant Trail steps while keeping the popover available", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("distant");
    cell.getBoundingClientRect = () => new DOMRect(20, 20_000, 400, 300);
    cell.scrollIntoView = vi.fn();
    controller.reveal({
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.reveal",
      payload: {
        id: "tour",
        steps: [
          { address: { kind: "cell", cellId: "distant" }, label: "Evidence" },
          { address: { kind: "cell", cellId: "distant" } },
        ],
      },
    });
    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
    const surface = projectTargetAttentionSurface(onChange.mock.lastCall?.[0], window);
    expect(surface.view?.presentation.trail?.index).toBe(0);
    expect(surface.fallback).toBeNull();
    cell.getBoundingClientRect = () => new DOMRect(20, 49, 400, 300);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersToNextFrame();
    const arriving = projectTargetAttentionSurface(onChange.mock.lastCall?.[0], window, {
      height: 44,
      maxWidth: 400,
    });
    expect(arriving.view).not.toBeNull();
    expect(arriving.fallback).toBeNull();
    controller.dispose();
  });

  test("skips unchanged layout notifications but publishes geometry and viewport changes", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("steady");
    let bounds = new DOMRect(20, 80, 400, 300);
    cell.getBoundingClientRect = () => bounds;
    controller.startActivity(startActivityEvent("steady"));
    const refresh = () => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersToNextFrame();
    };
    const initial = onChange.mock.calls.length;
    refresh();
    refresh();
    expect(onChange).toHaveBeenCalledTimes(initial);
    bounds = new DOMRect(20, 100, 400, 300);
    refresh();
    expect(onChange).toHaveBeenCalledTimes(initial + 1);
    expect(onChange.mock.lastCall?.[0].bounds).toEqual(bounds);
    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = originalWidth - 100;
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersToNextFrame();
      expect(onChange).toHaveBeenCalledTimes(initial + 2);
    } finally {
      window.innerWidth = originalWidth;
      controller.dispose();
    }
  });

  test("marks visible activity without scrolling or moving focus", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    const notifyResizes: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          notifyResizes.push(() => callback([], this));
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const cell = setupCell("new-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());

    controller.startActivity(startActivityEvent("new-cell"));
    for (const notifyResize of notifyResizes) notifyResize();

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("shows fallback when offscreen activity framing settles without movement", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cell = setupCell("fixed-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);

    controller.startActivity(startActivityEvent("fixed-cell"));
    const pending = onChange.mock.lastCall?.[0];
    expect(projectTargetAttentionSurface(pending, window)).toEqual({
      view: null,
      fallback: null,
    });

    vi.runOnlyPendingTimers();
    const settled = onChange.mock.lastCall?.[0];

    expect(projectTargetAttentionSurface(settled, window)).toEqual({
      view: null,
      fallback: { presentation: settled, reason: "offscreen" },
    });
    controller.dispose();
  });

  test("reframes an activity target that has no room for its label", () => {
    vi.useFakeTimers();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());
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

  test("reveals the cell wrapper instead of its nested output", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    controller.dispose();
  });

  test.each([-10_000, 10_000])("jumps directly to a distant reveal at %s", (top) => {
    vi.useFakeTimers();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());
    const cell = setupCell("distant");
    cell.getBoundingClientRect = () => new DOMRect(20, top, 400, 300);
    cell.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("distant", "Read the next chapter."));

    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    controller.dispose();
  });

  test("uses the duration carried by the reveal event", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("BYtC");
    cell.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("BYtC", "Read the verified result.", 8_000));

    vi.advanceTimersByTime(7_999);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "active" }));
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith(null);
    vi.runOnlyPendingTimers();
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("expires timed activity after its hold and exit", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("timed");

    controller.startActivity(startActivityEvent("timed", "Checking the chart.", 8_000));

    vi.advanceTimersByTime(7_999);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "active" }));
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "exiting" }));
    vi.runOnlyPendingTimers();
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("a stale stop cannot clear the activity that replaced it", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    setupCell("first");
    const second = setupCell("second");

    controller.startActivity(startActivityEvent("first", "Editing.", undefined, "old"));
    controller.startActivity(startActivityEvent("second", "Running.", undefined, "current"));
    controller.stopActivity(activityStopEvent("old"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "activity", message: "Running.", target: second }),
    );

    controller.stopActivity(activityStopEvent("current"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  test("reveal replaces activity", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    const cell = setupCell("same");
    cell.scrollIntoView = vi.fn();

    controller.startActivity(startActivityEvent("same", "Editing."));
    controller.reveal(revealEvent("same", "Verified."));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      kind: "reveal",
      message: "Verified.",
    });
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("attaches pending activity when its cell starts rendering", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    controller.startActivity(startActivityEvent("new-cell"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: null }));

    const cell = setupCell("new-cell");
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: cell }));
    controller.dispose();
  });

  test("reframes activity when its output target is replaced by the rendered cell", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const output = setupOutput("promoted");
    output.scrollIntoView = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    controller.startActivity(startActivityEvent("promoted"));

    const cell = setupCell("promoted");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    cell.scrollIntoView = vi.fn();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: cell }));
    expect(output.scrollIntoView).not.toHaveBeenCalled();
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("re-resolves a replaced reveal target without scrolling again", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    const notifyResizes: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          notifyResizes.push(() => callback([], this));
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const cell = setupCell("resized-reveal");
    cell.scrollIntoView = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());

    controller.reveal(revealEvent("resized-reveal"));
    for (const notifyResize of notifyResizes) notifyResize();

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("frames an initially missing reveal once when its target appears", () => {
    vi.useFakeTimers();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());
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
    const notifyResizes: Array<() => void> = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          notifyResizes.push(() => callback([], this));
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );
    const onChange = vi.fn();
    const cell = setupCell("resized");
    let rect = new DOMRect(20, 80, 400, 300);
    cell.getBoundingClientRect = () => rect;
    cell.scrollIntoView = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
    controller.startActivity(startActivityEvent("resized"));
    const callsBeforeResize = onChange.mock.calls.length;
    expect(cell.scrollIntoView).not.toHaveBeenCalled();

    rect = new DOMRect(20, 120, 400, window.innerHeight - 100);

    for (const notifyResize of notifyResizes) notifyResize();

    expect(observe).toHaveBeenCalledWith(cell);
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.length).toBeGreaterThan(callsBeforeResize);
    controller.dispose();
    expect(disconnect).toHaveBeenCalled();
  });

  test("uses reduced motion on an output fallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const controller = new TestAttentionController(new NotebookDomAdapter(document), vi.fn());
    const output = setupOutput("fallback");
    output.scrollIntoView = vi.fn();

    controller.reveal(revealEvent("fallback"));

    expect(output.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    controller.dispose();
  });

  test("keeps activity through target removal and reattaches it", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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
    for (const element of [secondary, secondaryDocument.body, secondaryDocument.documentElement]) {
      element.scrollTo = vi.fn();
    }
    secondaryDocument.body.appendChild(secondary);
    const controller = new TestAttentionController(
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
    const controller = new TestAttentionController(new NotebookDomAdapter(document), onChange);
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

class TestAttentionController extends TargetAttentionController {
  readonly #testDom: NotebookDomAdapter;

  constructor(
    dom: NotebookDomAdapter,
    onChange: (presentation: TargetAttentionPresentation | null) => void,
  ) {
    super(dom, onChange);
    this.#testDom = dom;
  }

  startActivity(event: AttentionActivityStartEvent): void {
    super.startActivity(event, cellTarget(this.#testDom.document, event.payload.address));
  }

  reveal(event: AttentionRevealEvent): void {
    super.reveal(
      event,
      event.payload.steps.map((step) => cellTarget(this.#testDom.document, step.address)),
    );
  }
}

function cellTarget(
  ownerDocument: Document,
  address: AttentionActivityStartEvent["payload"]["address"],
): TargetLocator {
  if (address.kind !== "cell") throw new Error("Expected a cell address");
  return {
    kind: "cell",
    label: address.cellId,
    resolve: () => {
      const ownerWindow = ownerDocument.defaultView;
      const cell = ownerDocument.getElementById(`cell-${address.cellId}`);
      if (ownerWindow && cell instanceof ownerWindow.HTMLElement && cell.isConnected) return cell;
      const output = ownerDocument.getElementById(`output-${address.cellId}`);
      return ownerWindow && output instanceof ownerWindow.HTMLElement && output.isConnected
        ? output
        : null;
    },
  };
}

function startActivityEvent(
  cellId: string,
  message?: string,
  durationMs?: number,
  activityId = cellId,
): AttentionActivityStartEvent {
  const payload: AttentionActivityStartEvent["payload"] = {
    activityId,
    address: { kind: "cell", cellId },
  };
  if (durationMs !== undefined) payload.durationMs = durationMs;
  if (message) payload.message = message;
  return {
    protocol: "marimo-lens.event",
    version: 6,
    type: "attention.activity.start",
    payload,
  };
}

function activityStopEvent(activityId: string): AttentionActivityStopEvent {
  return {
    protocol: "marimo-lens.event",
    version: 6,
    type: "attention.activity.stop",
    payload: { activityId },
  };
}

function revealEvent(cellId: string, message?: string, durationMs = 4_000): AttentionRevealEvent {
  const payload: AttentionRevealEvent["payload"] = {
    id: "reveal-1",
    steps: [{ address: { kind: "cell", cellId } }],
    durationMs,
  };
  if (message) payload.steps[0]!.message = message;
  return {
    protocol: "marimo-lens.event",
    version: 6,
    type: "attention.reveal",
    payload,
  };
}
