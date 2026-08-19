import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("notebook DOM layout subscriptions", () => {
  test("shares one observer lifecycle across subscribers", () => {
    const disconnectMutation = vi.fn();
    const disconnectResize = vi.fn();
    const MutationObserverStub = vi.fn(
      class {
        observe = vi.fn();
        disconnect = disconnectMutation;
      },
    );
    const resizeObserve = vi.fn();
    const ResizeObserverStub = vi.fn(
      class {
        observe = resizeObserve;
        unobserve = vi.fn();
        disconnect = disconnectResize;
      },
    );
    vi.stubGlobal("MutationObserver", MutationObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const dom = new NotebookDomAdapter(document);

    const releaseFirst = dom.subscribeLayout(() => {});
    const releaseSecond = dom.subscribeLayout(() => {});

    expect(MutationObserverStub).toHaveBeenCalledOnce();
    expect(ResizeObserverStub).toHaveBeenCalledOnce();

    releaseFirst();
    expect(disconnectMutation).not.toHaveBeenCalled();
    expect(disconnectResize).not.toHaveBeenCalled();

    releaseSecond();
    expect(disconnectMutation).toHaveBeenCalledOnce();
    expect(disconnectResize).toHaveBeenCalledOnce();
  });

  test("coalesces output topology scans until the next paint", () => {
    let notifyMutation = () => {};
    const MutationObserverStub = vi.fn(
      class implements MutationObserver {
        constructor(callback: MutationCallback) {
          notifyMutation = () => callback([], this);
        }

        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = () => [];
      },
    );
    const resizeObserve = vi.fn();
    const ResizeObserverStub = vi.fn(
      class {
        observe = resizeObserve;
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal("MutationObserver", MutationObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const listener = vi.fn();
    const dom = new NotebookDomAdapter(document);
    const release = dom.subscribeLayout(listener);

    const output = document.createElement("div");
    output.id = "output-later-cell";
    document.body.appendChild(output);
    notifyMutation();
    notifyMutation();
    expect(resizeObserve).not.toHaveBeenCalledWith(output);
    expect(listener).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    const pending = [...frames.entries()][0];
    if (!pending) throw new Error("Layout refresh was not scheduled");
    frames.delete(pending[0]);
    pending[1](0);

    expect(resizeObserve).toHaveBeenCalledWith(output);
    expect(listener).toHaveBeenCalledOnce();
    release();
  });

  test("observes hidden output roots so a CSS reveal updates layout", () => {
    const output = document.createElement("div");
    output.id = "output-hidden-cell";
    output.style.display = "none";
    document.body.appendChild(output);

    const observe = vi.fn();
    const ResizeObserverStub = vi.fn(
      class {
        observe = observe;
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const dom = new NotebookDomAdapter(document);

    const release = dom.subscribeLayout(() => {});

    expect(observe).toHaveBeenCalledWith(output);
    release();
  });

  test("invalidates layout when content scrolls inside an open shadow root", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    shadow.appendChild(scroller);
    document.body.appendChild(host);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const listener = vi.fn();
    const dom = new NotebookDomAdapter(document);
    const release = dom.subscribeLayout(listener);

    scroller.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);

    expect(listener).toHaveBeenCalledOnce();
    release();
  });

  test("stops observing a shadow tree after its host is removed", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const survivingHost = document.createElement("div");
    const survivingShadow = survivingHost.attachShadow({ mode: "open" });
    document.body.append(host, survivingHost);
    const observedTargets = new Set<Node>();
    let notifyMutation = (_target: Node) => {};
    const MutationObserverStub = vi.fn(
      class implements MutationObserver {
        constructor(callback: MutationCallback) {
          notifyMutation = (target) => {
            if (observedTargets.has(target)) callback([], this);
          };
        }

        observe = vi.fn((target: Node) => observedTargets.add(target));
        disconnect = vi.fn(() => observedTargets.clear());
        takeRecords = () => [];
      },
    );
    vi.stubGlobal("MutationObserver", MutationObserverStub);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const dom = new NotebookDomAdapter(document);
    const release = dom.subscribeLayout(() => {});

    expect(observedTargets.has(shadow)).toBe(true);
    expect(observedTargets.has(survivingShadow)).toBe(true);
    host.remove();
    notifyMutation(document.body);
    frames.shift()?.(0);

    expect(observedTargets.has(document.body)).toBe(true);
    expect(observedTargets.has(shadow)).toBe(false);
    expect(observedTargets.has(survivingShadow)).toBe(true);
    notifyMutation(shadow);
    expect(frames).toHaveLength(0);
    notifyMutation(survivingShadow);
    expect(frames).toHaveLength(1);
    release();
  });
});

describe("notebook DOM paint scheduling", () => {
  test("continues without a paint when the notebook is hidden", async () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const dom = new NotebookDomAdapter(document);

    await expect(dom.afterNextPaint(new AbortController().signal)).resolves.toBeUndefined();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  test("falls back when a visible document misses its animation frame", async () => {
    vi.useFakeTimers();
    const cancelFrame = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame);
    const dom = new NotebookDomAdapter(document);

    const ready = dom.afterNextPaint(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(ready).resolves.toBeUndefined();
    expect(cancelFrame).toHaveBeenCalledWith(7);
    vi.useRealTimers();
  });

  test("cancels a pending paint wait", async () => {
    vi.useFakeTimers();
    const cancelFrame = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(11);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame);
    const dom = new NotebookDomAdapter(document);
    const controller = new AbortController();
    const reason = new DOMException("Capture was canceled", "AbortError");

    const ready = dom.afterNextPaint(controller.signal);
    controller.abort(reason);

    await expect(ready).rejects.toBe(reason);
    expect(cancelFrame).toHaveBeenCalledWith(11);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
