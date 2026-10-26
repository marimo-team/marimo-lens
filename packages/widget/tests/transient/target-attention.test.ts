import type { AttentionActivityStartEvent, Trail } from "@marimo-lens/protocol";

import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import {
  TargetAttentionController,
  type TargetAttentionPresentation,
  type TargetLocator,
  type TrailNavigation,
} from "@/transient/target-attention";
import { projectTargetAttentionSurface } from "@/transient/target-attention-indicator";

import { outputFixture } from "../support/fixtures";

let onChange: Mock<(presentation: TargetAttentionPresentation | null) => void>;
let controller: TestAttentionController | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  onChange = vi.fn();
});

afterEach(() => {
  controller?.dispose();
  controller = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("target attention", () => {
  test("obsolete Trail controls cannot replace newer attention", () => {
    const attention = attend();
    setupCell("first");
    const second = setupCell("second");
    attention.reveal(
      trail("trail-1", [
        { cellId: "first", label: "Question" },
        { cellId: "second", label: "Answer" },
      ]),
    );
    const navigation = trailOf();
    attention.reveal(trail("current", [{ cellId: "second", label: "Current result" }]));
    navigation.next();
    navigation.close();
    expect(latest()).toMatchObject({ target: second, trail: { id: "current" } });
    const currentNavigation = trailOf();
    attention.startActivity(activity("second", "New work"));
    currentNavigation.next();
    currentNavigation.close();
    expect(latest()).toMatchObject({ kind: "activity", target: second, message: "New work" });
    expect(latest().trail).toBeUndefined();
  });

  test("navigation shares one reveal deadline and expired controls cannot revive it", () => {
    const attention = attend();
    setupCell("first");
    setupCell("second");
    attention.reveal(trail("timed", [{ cellId: "first" }, { cellId: "second" }], 4_000));
    const first = latest();
    vi.advanceTimersByTime(3_000);
    trailOf(first).next();
    expect(latest()).toMatchObject({ expiresAt: first.expiresAt, locator: { label: "second" } });
    vi.advanceTimersByTime(1_000);
    expect(latest().phase).toBe("exiting");
    trailOf(first).previous();
    expect(latest().phase).toBe("exiting");
    vi.runOnlyPendingTimers();
    expect(onChange).toHaveBeenLastCalledWith(null);
    trailOf(first).next();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("does not publish a reveal whose lifetime elapsed while framing its target", () => {
    const attention = attend();
    setupCell("slow").scrollIntoView = () => vi.setSystemTime(Date.now() + 60_000);
    attention.reveal(revealTrail("slow", "Brief result", 1));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("smoothly frames distant Trail steps while keeping the popover available", () => {
    const attention = attend();
    const cell = setupCell("distant");
    cell.getBoundingClientRect = () => new DOMRect(20, 20_000, 400, 300);
    attention.reveal(
      trail("tour", [{ cellId: "distant", label: "Evidence" }, { cellId: "distant" }]),
    );
    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("smooth"));
    const surface = projectTargetAttentionSurface(latest(), window);
    expect(surface.view?.presentation.trail?.index).toBe(0);
    expect(surface.fallback).toBeNull();
    cell.getBoundingClientRect = () => new DOMRect(20, 49, 400, 300);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersToNextFrame();
    const arriving = projectTargetAttentionSurface(latest(), window, {
      height: 44,
      maxWidth: 400,
    });
    expect(arriving.view).not.toBeNull();
    expect(arriving.fallback).toBeNull();
  });

  test("skips unchanged layout notifications but publishes geometry and viewport changes", () => {
    const attention = attend();
    const cell = setupCell("steady");
    let bounds = new DOMRect(20, 80, 400, 300);
    cell.getBoundingClientRect = () => bounds;
    attention.startActivity(activity("steady"));
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
    const moved = latest();
    expect(moved.bounds).toEqual(bounds);
    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = originalWidth - 100;
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersToNextFrame();
      expect(latest()).not.toBe(moved);
      expect(latest()).toMatchObject({ target: cell, bounds });
    } finally {
      window.innerWidth = originalWidth;
    }
  });

  test("publishes a resized marimo pane when target bounds stay fixed", () => {
    const resize = stubResizeObserver();
    const cell = setupCell("pane-cell");
    cell.getBoundingClientRect = () => new DOMRect(320, 100, 400, 300);
    let pane = new DOMRect(300, 0, 900, 680);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => pane;
    const host = document.createElement("span");
    app.append(host, cell);
    document.body.append(app);
    const dom = new NotebookDomAdapter(document);
    const release = dom.registerHost(host);
    const attention = attend(dom);
    attention.startActivity(activity("pane-cell"));
    expect(latest().viewport).toMatchObject({ left: 300 });

    pane = new DOMRect(400, 0, 800, 680);
    resize.notify(app);
    vi.advanceTimersToNextFrame();

    expect(latest().viewport).toMatchObject({ left: 400 });
    release();
  });

  test("marks visible activity without scrolling or moving focus", () => {
    const attention = attend();
    const cell = setupCell("BYtC");
    const focused = document.createElement("button");
    document.body.appendChild(focused);
    focused.focus();

    attention.startActivity(activity("BYtC", "Updating the aggregation."));

    expect(cell.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focused);
    expect(latest()).toMatchObject({ kind: "activity", target: cell, phase: "active" });
  });

  test("brings an offscreen activity target into view once", () => {
    const attention = attend();
    const cell = setupCell("new-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);

    attention.startActivity(activity("new-cell", "Building the requested chart."));

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("smooth"));
  });

  test("frames a window-visible target hidden behind marimo chrome", () => {
    const cell = setupCell("covered-cell");
    cell.getBoundingClientRect = () => new DOMRect(50, 100, 300, 200);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 0, 900, 680);
    const host = document.createElement("span");
    app.append(cell, host);
    document.body.append(app);
    const dom = new NotebookDomAdapter(document);
    const release = dom.registerHost(host);

    attend(dom).startActivity(activity("covered-cell"));

    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("smooth"));
    release();
  });

  test("shows fallback when offscreen activity framing settles without movement", () => {
    const cell = setupCell("fixed-cell");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);

    attend().startActivity(activity("fixed-cell"));
    expect(projectTargetAttentionSurface(latest(), window)).toEqual({
      view: null,
      fallback: null,
    });

    vi.runOnlyPendingTimers();
    const settled = latest();

    expect(projectTargetAttentionSurface(settled, window)).toEqual({
      view: null,
      fallback: { presentation: settled, reason: "offscreen" },
    });
  });

  test("reframes an activity target that has no room for its label", () => {
    const cell = setupCell("near-top");
    cell.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);

    attend().startActivity(activity("near-top", "Checking the chart."));

    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("smooth"));
  });

  test("reveals the cell wrapper instead of its nested output", () => {
    const cell = setupCell("BYtC");
    const output = setupOutput("BYtC");

    attend().reveal(revealTrail("BYtC", "Updated the aggregation."));

    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("smooth"));
    expect(output.scrollIntoView).not.toHaveBeenCalled();
  });

  test.each([-10_000, 10_000])("jumps directly to a distant reveal at %s", (top) => {
    const cell = setupCell("distant");
    cell.getBoundingClientRect = () => new DOMRect(20, top, 400, 300);

    attend().reveal(revealTrail("distant", "Read the next chapter."));

    expect(cell.scrollIntoView).toHaveBeenCalledWith(scrolled("instant"));
  });

  test.each([
    [
      "reveal",
      (attention: TestAttentionController) =>
        attention.reveal(revealTrail("timed", "Read the verified result.", 8_000)),
    ],
    [
      "activity",
      (attention: TestAttentionController) =>
        attention.startActivity(activity("timed", "Checking the chart.", 8_000)),
    ],
  ] as const)("expires a timed %s after its duration and exit", (_kind, start) => {
    const attention = attend();
    setupCell("timed");

    start(attention);

    vi.advanceTimersByTime(7_999);
    expect(latest()).toMatchObject({ phase: "active" });
    vi.advanceTimersByTime(1);
    expect(latest()).toMatchObject({ phase: "exiting" });
    vi.runOnlyPendingTimers();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("a stale stop cannot clear the activity that replaced it", () => {
    const attention = attend();
    setupCell("first");
    const second = setupCell("second");

    attention.startActivity(activity("first", "Editing.", undefined, "old"));
    attention.startActivity(activity("second", "Running.", undefined, "current"));
    attention.stopActivity("old");
    expect(latest()).toMatchObject({ kind: "activity", message: "Running.", target: second });

    attention.stopActivity("current");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("reveal replaces activity", () => {
    const attention = attend();
    const cell = setupCell("same");

    attention.startActivity(activity("same", "Editing."));
    attention.reveal(revealTrail("same", "Verified."));
    expect(latest()).toMatchObject({ kind: "reveal", message: "Verified." });
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
  });

  test("attaches pending activity when its cell starts rendering", () => {
    attend().startActivity(activity("new-cell"));
    expect(latest()).toMatchObject({ target: null });

    const cell = setupCell("new-cell");
    refresh();

    expect(latest()).toMatchObject({ target: cell });
  });

  test("reframes activity when its output target is replaced by the rendered cell", () => {
    const output = setupOutput("promoted");
    attend().startActivity(activity("promoted"));

    const cell = setupCell("promoted");
    cell.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 100, 400, 300);
    refresh();

    expect(latest()).toMatchObject({ target: cell });
    expect(output.scrollIntoView).not.toHaveBeenCalled();
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
  });

  test.each([
    {
      change: "its target appears late",
      run: () => {
        attend().reveal(revealTrail("framed"));
        const cell = setupCell("framed");
        refresh();
        refresh();
        return { target: cell, framed: [cell] };
      },
    },
    {
      change: "its target is replaced",
      run: () => {
        const first = setupCell("framed");
        attend().reveal(revealTrail("framed"));
        first.remove();
        refresh();
        const replacement = setupCell("framed");
        refresh();
        return { target: replacement, framed: [first, replacement] };
      },
    },
    {
      change: "its target resizes",
      run: () => {
        const resize = stubResizeObserver();
        const cell = setupCell("framed");
        attend().reveal(revealTrail("framed"));
        resize.notify();
        return { target: cell, framed: [cell] };
      },
    },
  ])("frames a reveal once when $change", ({ run }) => {
    const { target, framed } = run();

    expect(latest()).toMatchObject({ target });
    const scrolls = framed.map((element) => vi.mocked(element.scrollIntoView).mock.calls.length);
    expect(scrolls.reduce((total, count) => total + count, 0)).toBe(1);
  });

  test("reframes activity after its cell grows beyond the viewport", () => {
    const resize = stubResizeObserver();
    const cell = setupCell("resized");
    let rect = new DOMRect(20, 80, 400, 300);
    cell.getBoundingClientRect = () => rect;
    const attention = attend();
    attention.startActivity(activity("resized"));
    const callsBeforeResize = onChange.mock.calls.length;
    expect(cell.scrollIntoView).not.toHaveBeenCalled();

    rect = new DOMRect(20, 120, 400, window.innerHeight - 100);
    resize.notify();

    expect(resize.observe).toHaveBeenCalledWith(cell);
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(onChange.mock.calls.length).toBeGreaterThan(callsBeforeResize);
    attention.dispose();
    expect(resize.disconnect).toHaveBeenCalled();
  });

  test("uses reduced motion on an output fallback", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const output = setupOutput("fallback");

    attend().reveal(revealTrail("fallback"));

    expect(output.scrollIntoView).toHaveBeenCalledWith(scrolled("instant"));
  });

  test("keeps activity through target removal and reattaches it", () => {
    const cell = setupCell("removed");
    attend().startActivity(activity("removed"));

    cell.remove();
    refresh();

    expect(latest()).toMatchObject({ kind: "activity", target: null });

    const replacement = setupCell("removed");
    refresh();

    expect(latest()).toMatchObject({ kind: "activity", target: replacement });
  });

  test("keeps activity while its notebook document is hidden", () => {
    const attention = attend();
    setupCell("hidden");
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      attention.startActivity(activity("hidden"));
      vi.setSystemTime(Date.now() + 21_000);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(latest()).toMatchObject({ kind: "activity", target: expect.any(HTMLElement) });
    } finally {
      if (visibility) Object.defineProperty(document, "visibilityState", visibility);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  });

  test("uses the mounted notebook document", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const secondaryDocument = frame.contentDocument!;
    const primary = setupCell("shared");
    const secondary = secondaryDocument.createElement("section");
    secondary.id = "cell-shared";
    secondary.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);
    secondary.scrollIntoView = vi.fn();
    for (const element of [secondary, secondaryDocument.body, secondaryDocument.documentElement]) {
      element.scrollTo = vi.fn();
    }
    secondaryDocument.body.appendChild(secondary);

    attend(new NotebookDomAdapter(secondaryDocument)).reveal(revealTrail("shared"));

    expect(secondary.scrollIntoView).toHaveBeenCalledOnce();
    expect(primary.scrollIntoView).not.toHaveBeenCalled();
  });

  test("disposal clears the presentation and cancels later updates", () => {
    const attention = attend();
    setupCell("disposed");
    attention.startActivity(activity("disposed"));

    attention.dispose();
    const callsAfterDispose = onChange.mock.calls.length;
    expect(onChange).toHaveBeenLastCalledWith(null);

    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenCalledTimes(callsAfterDispose);
  });
});

function attend(dom = new NotebookDomAdapter(document)): TestAttentionController {
  controller = new TestAttentionController(dom, onChange);
  return controller;
}

function latest(): TargetAttentionPresentation {
  const presentation = onChange.mock.lastCall?.[0];
  if (!presentation) throw new Error("Expected a published presentation");
  return presentation;
}

function trailOf(presentation = latest()): TrailNavigation {
  if (!presentation.trail) throw new Error("Expected Trail navigation");
  return presentation.trail;
}

function refresh(): void {
  window.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(20);
}

function scrolled(behavior: ScrollBehavior) {
  return expect.objectContaining({ behavior });
}

function stubResizeObserver() {
  const observers: Array<{ notify: () => void; targets: Set<Element> }> = [];
  const observe = vi.fn<(target: Element) => void>();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      readonly #targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ notify: () => callback([], this), targets: this.#targets });
      }
      observe = (target: Element) => {
        observe(target);
        this.#targets.add(target);
      };
      unobserve = (target: Element) => {
        this.#targets.delete(target);
      };
      disconnect = () => {
        disconnect();
        this.#targets.clear();
      };
    },
  );
  return {
    observe,
    disconnect,
    notify(target?: Element) {
      for (const observer of observers) {
        if (!target || observer.targets.has(target)) observer.notify();
      }
    },
  };
}

function setupCell(cellId: string): HTMLElement {
  const cell = document.createElement("section");
  cell.id = `cell-${cellId}`;
  cell.getBoundingClientRect = () => new DOMRect(20, 80, 400, 300);
  cell.scrollIntoView = vi.fn();
  document.body.appendChild(cell);
  return cell;
}

function setupOutput(cellId: string): HTMLElement {
  return Object.assign(outputFixture(cellId, new DOMRect(20, 80, 400, 240)), {
    scrollIntoView: vi.fn(),
  });
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

  startActivity(payload: Activity): void {
    super.startActivity(payload, cellTarget(this.#testDom.document, payload.address));
  }

  reveal(route: Trail): void {
    super.reveal(
      route,
      route.steps.map((step) => cellTarget(this.#testDom.document, step.address)),
    );
  }
}

function cellTarget(ownerDocument: Document, address: Activity["address"]): TargetLocator {
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

type Activity = AttentionActivityStartEvent["payload"];

function activity(
  cellId: string,
  message?: string,
  durationMs?: number,
  activityId = cellId,
): Activity {
  const payload: Activity = { activityId, address: { kind: "cell", cellId } };
  if (durationMs !== undefined) payload.durationMs = durationMs;
  if (message) payload.message = message;
  return payload;
}

type TrailStep = { cellId: string; label?: string; message?: string };

function trail(id: string, steps: TrailStep[], durationMs?: number): Trail {
  const route: Trail = {
    id,
    steps: steps.map(({ cellId, ...text }) => ({ address: { kind: "cell", cellId }, ...text })),
  };
  if (durationMs !== undefined) route.durationMs = durationMs;
  return route;
}

function revealTrail(cellId: string, message?: string, durationMs = 4_000): Trail {
  return trail("reveal-1", [message ? { cellId, message } : { cellId }], durationMs);
}
