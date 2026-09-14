import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function paint() {
  await Promise.resolve();
  vi.advanceTimersToNextFrame();
}

describe("notebook DOM layout subscriptions", () => {
  test("stops scrolling ancestors across a shadow root at their current positions", () => {
    const host = document.createElement("div");
    const scroller = document.createElement("div");
    host.attachShadow({ mode: "open" }).append(scroller);
    const target = document.createElement("div");
    scroller.append(target);
    document.body.append(host);
    scroller.scrollTop = 123;
    host.scrollLeft = 45;
    const inner = vi.spyOn(scroller, "scrollTo");
    const outer = vi.spyOn(host, "scrollTo");
    new NotebookDomAdapter(document).stopScroll(target);
    expect(inner).toHaveBeenCalledWith({ top: 123, left: 0, behavior: "instant" });
    expect(outer).toHaveBeenCalledWith({ top: 0, left: 45, behavior: "instant" });
  });

  test("coalesces output layout changes and ignores its own overlay", async () => {
    vi.useFakeTimers();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        unobserve() {}
        disconnect() {}
      },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const dom = new NotebookDomAdapter(document);
    const unregister = dom.registerUiRoot(shadow);
    const listener = vi.fn();
    const release = dom.subscribeLayout(listener);
    shadow.append(document.createElement("button"));
    await paint();
    expect(listener).not.toHaveBeenCalled();

    const output = document.createElement("div");
    output.id = "output-new";
    document.body.append(output);
    await Promise.resolve();
    output.append(document.createElement("span"));
    await Promise.resolve();
    expect(observe).not.toHaveBeenCalledWith(output);
    expect(listener).not.toHaveBeenCalled();
    await paint();
    expect(observe).toHaveBeenCalledWith(output);
    expect(listener).toHaveBeenCalledOnce();
    release();
    unregister();
  });

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

  test("tracks scrolling and mutations only in attached shadow trees", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    shadow.append(scroller);
    const survivingHost = document.createElement("div");
    const survivingShadow = survivingHost.attachShadow({ mode: "open" });
    document.body.append(host, survivingHost);
    const listener = vi.fn();
    const release = new NotebookDomAdapter(document).subscribeLayout(listener);
    scroller.dispatchEvent(new Event("scroll"));
    await paint();
    expect(listener).toHaveBeenCalledOnce();

    host.remove();
    await paint();
    listener.mockClear();
    scroller.dispatchEvent(new Event("scroll"));
    shadow.append(document.createElement("span"));
    await paint();
    expect(listener).not.toHaveBeenCalled();
    survivingShadow.append(document.createElement("span"));
    await paint();
    expect(listener).toHaveBeenCalledOnce();
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
  });
});
