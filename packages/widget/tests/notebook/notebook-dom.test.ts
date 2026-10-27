import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";

afterEach(() => {
  Reflect.deleteProperty(window, "visualViewport");
  Reflect.deleteProperty(document, "fullscreenElement");
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
  test("uses the marimo app pane as the visible notebook viewport", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 24, 900, 640);
    const widget = document.createElement("marimo-anywidget");
    const host = document.createElement("span");
    widget.attachShadow({ mode: "open" }).append(host);
    app.append(widget);
    document.body.append(app);

    const dom = new NotebookDomAdapter(document);
    const release = dom.registerHost(host);
    expect(dom.viewportBounds()).toMatchObject({
      left: 320,
      top: 24,
      right: 1_220,
      bottom: 664,
      width: 900,
      height: 640,
    });
    release();
  });

  test("reports no visible area for a collapsed marimo app pane", () => {
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 24, 0, 640);
    const host = document.createElement("span");
    app.append(host);
    document.body.append(app);

    const dom = new NotebookDomAdapter(document);
    const release = dom.registerHost(host);
    expect(dom.viewportBounds()).toMatchObject({ width: 0, height: 0 });
    release();
  });

  test("falls back to the browser viewport outside marimo", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);

    expect(new NotebookDomAdapter(document).viewportBounds()).toMatchObject({
      left: 0,
      top: 0,
      right: 1_280,
      bottom: 720,
      width: 1_280,
      height: 720,
    });
  });

  test("mounts Lens UI inside the marimo app pane and clips it to the pane", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 24, 900, 640);
    const host = document.createElement("span");
    app.append(host);
    document.body.append(app);
    // The portal has no layout box yet, as before its shadow stylesheet applies.
    const portal = document.createElement("div");
    const uiRoot = portal.attachShadow({ mode: "open" });

    const dom = new NotebookDomAdapter(document);
    const releaseHost = dom.registerHost(host);
    const releaseUi = dom.registerUiRoot(uiRoot);

    expect(portal.parentElement).toBe(app);
    expect(portal.hasAttribute("data-marimo-lens-pane")).toBe(true);
    expect(portal.style.getPropertyValue("--marimo-lens-pane-clip")).toBe(
      "inset(24px calc(100% - 1220px) calc(100% - 664px) 320px)",
    );
    releaseUi();
    expect(portal.isConnected).toBe(false);
    releaseHost();
    dom.dispose();
  });

  test("moves the same Lens UI into fullscreen and restores the pane on exit", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 24, 900, 640);
    const host = document.createElement("span");
    const output = document.createElement("div");
    output.id = "output-cell";
    output.getBoundingClientRect = () => new DOMRect(0, 0, 1_280, 720);
    const other = document.createElement("div");
    other.id = "output-other";
    other.getBoundingClientRect = () => new DOMRect(320, 24, 900, 200);
    const otherCell = document.createElement("div");
    otherCell.id = "cell-other";
    otherCell.append(other);
    app.append(host, output, otherCell);
    document.body.append(app);
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreen,
    });
    const portal = document.createElement("div");
    const root = portal.attachShadow({ mode: "open" });
    const note = document.createElement("textarea");
    note.value = "Keep this note";
    root.append(note);
    const dom = new NotebookDomAdapter(document);
    const releaseHost = dom.registerHost(host);
    const releaseUi = dom.registerUiRoot(root);
    const listener = vi.fn();
    const releaseLayout = dom.subscribeLayout(listener);
    const otherTarget = dom.targetFromElement(other)!;

    fullscreen = output;
    document.dispatchEvent(new Event("fullscreenchange"));
    await paint();

    expect(portal.parentElement).toBe(output);
    expect(dom.viewportBounds()).toMatchObject({ left: 0, top: 0, width: 1_280, height: 720 });
    expect(listener).toHaveBeenCalled();
    expect(note.value).toBe("Keep this note");
    expect(dom.listTargets().map(({ target }) => target.cellIds)).toEqual([["cell"]]);
    expect(dom.getTarget(otherTarget.target)).toBeNull();
    expect(dom.targetFromElement(other)).toBeNull();
    const resolveEvent = vi.fn((event: Event) => dom.targetFromEvent(event));
    other.addEventListener("pointerdown", resolveEvent, { once: true });
    other.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(resolveEvent).toHaveReturnedWith(null);
    expect(dom.targetFromElement(output)?.element).toBe(output);
    expect(dom.getOutputCell("other")).toBeNull();
    expect(dom.getCell("other")).toBeNull();

    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await paint();

    expect(portal.parentElement).toBe(app);
    expect(dom.viewportBounds()).toMatchObject({ left: 320, top: 24, width: 900, height: 640 });
    expect(dom.uiRoot).toBe(root);
    expect(dom.getTarget(otherTarget.target)?.element).toBe(other);
    expect(dom.targetFromElement(other)?.element).toBe(other);
    expect(dom.getCell("other")).toBe(otherCell);
    releaseUi();
    fullscreen = output;
    document.dispatchEvent(new Event("fullscreenchange"));
    await paint();
    expect(portal.isConnected).toBe(false);
    releaseLayout();
    releaseHost();
    dom.dispose();
  });

  test("mounts in an already fullscreen output and ignores fullscreen outside its pane", () => {
    const app = document.createElement("main");
    app.id = "App";
    const host = document.createElement("span");
    const output = document.createElement("div");
    const unrelated = document.createElement("div");
    app.append(host, output);
    document.body.append(app, unrelated);
    let fullscreen = output;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreen,
    });
    const portal = document.createElement("div");
    const dom = new NotebookDomAdapter(document);
    const releaseHost = dom.registerHost(host);
    const releaseUi = dom.registerUiRoot(portal.attachShadow({ mode: "open" }));

    expect(portal.parentElement).toBe(output);
    fullscreen = unrelated;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(portal.parentElement).toBe(app);
    releaseUi();
    releaseHost();
    dom.dispose();
  });

  test("publishes visual viewport changes through the viewport subscription", async () => {
    vi.useFakeTimers();
    const visualViewport = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      width: 800,
      height: 600,
      scale: 1,
      onresize: null,
      onscroll: null,
    }) satisfies VisualViewport;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const listener = vi.fn();
    const dom = new NotebookDomAdapter(document);
    const release = dom.subscribeViewport(listener);

    visualViewport.dispatchEvent(new Event("resize"));
    await paint();

    expect(listener).toHaveBeenCalledOnce();
    release();
  });

  test("treats marimo pane resizing as geometry instead of output content", async () => {
    vi.useFakeTimers();
    // Each target notifies only the observer that watches it.
    const observers = new Map<Element, (target: Element) => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(readonly callback: ResizeObserverCallback) {}
        observe = (target: Element) =>
          observers.set(target, () => this.callback([resizeEntry(target)], this));
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const notify = (target: Element) => observers.get(target)?.(target);
    const app = document.createElement("main");
    app.id = "App";
    const host = document.createElement("span");
    const output = document.createElement("div");
    output.id = "output-cell";
    app.append(host, output);
    document.body.append(app);
    const dom = new NotebookDomAdapter(document);
    const releaseHost = dom.registerHost(host);
    const listener = vi.fn();
    const releaseLayout = dom.subscribeLayout(listener);
    const revision = dom.contentRevision(output);

    notify(app);
    await paint();

    expect(listener).toHaveBeenCalledOnce();
    expect(dom.contentRevision(output)).toBe(revision);
    releaseLayout();
    releaseHost();
  });

  test("unsupported :has selectors do not interrupt layout notifications", async () => {
    vi.useFakeTimers();
    const closest = Element.prototype.closest;
    vi.spyOn(Element.prototype, "closest").mockImplementation(function (this: Element, selector) {
      if (selector.includes(":has(")) throw new DOMException("Unsupported :has", "SyntaxError");
      return closest.call(this, selector);
    });
    const output = document.createElement("div");
    output.id = "output-native";
    document.body.append(output);
    const listener = vi.fn();
    const release = new NotebookDomAdapter(document).subscribeLayout(listener);
    output.className = "changed";
    await paint();
    expect(listener).toHaveBeenCalled();
    release();
  });

  test("default scoped targets observe resizing and rebind after grouping changes", async () => {
    vi.useFakeTimers();
    const observed = new Set<Element>();
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = () => callback([...observed].map(resizeEntry), this);
        }
        observe(element: Element) {
          observed.add(element);
        }
        unobserve(element: Element) {
          observed.delete(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    document.body.innerHTML =
      '<main data-marimo-lens-scope=".group"><article class="group"><p>Text</p></article></main>';
    const card = document.querySelector("article")!;
    const text = document.querySelector("p")!;
    for (const element of [card, text])
      element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    const dom = new NotebookDomAdapter(document);
    const listener = vi.fn();
    const release = dom.subscribeLayout(listener);
    expect(observed.has(card)).toBe(true);
    expect(observed.has(text)).toBe(false);
    resized();
    await paint();
    expect(listener).toHaveBeenCalled();
    card.className = "";
    await paint();
    expect(observed.has(text)).toBe(true);
    card.className = "group";
    await paint();
    expect(observed.has(card)).toBe(true);
    expect(observed.has(text)).toBe(false);
    release();
    expect(observed.size).toBe(0);
  });

  test("refreshes default Lens when an existing region opts in or out", async () => {
    vi.useFakeTimers();
    const heading = document.createElement("h1");
    heading.id = "intro";
    heading.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    document.body.append(heading);
    const dom = new NotebookDomAdapter(document);
    const targets: HTMLElement[][] = [];
    const release = dom.subscribeLayout(() => {
      targets.push(dom.listTargets().map(({ element }) => element));
    });
    heading.dataset.marimoLensTarget = "";
    await paint();
    expect(targets.at(-1)).toEqual([heading]);
    delete heading.dataset.marimoLensTarget;
    await paint();
    expect(targets.at(-1)).toEqual([]);
    release();
  });

  test("finds a target that arrives or leaves inside a larger subtree", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main></main>";
    const dom = new NotebookDomAdapter(document);
    const targets: string[][] = [];
    const release = dom.subscribeLayout(() => {
      targets.push(dom.listTargets().map(({ element }) => element.id));
    });
    const section = document.createElement("section");
    section.innerHTML = '<div><h2 id="summary" data-marimo-lens-target></h2></div>';
    section.querySelector("h2")!.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);

    document.querySelector("main")!.append(section);
    await paint();
    const added = targets.at(-1);
    section.remove();
    await paint();

    expect(added).toEqual(["summary"]);
    expect(targets.at(-1)).toEqual([]);
    release();
  });

  test("typing outside every target leaves the target map alone", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<main><h1 id="intro" data-marimo-lens-target></h1><div class="editor"></div></main>';
    const dom = new NotebookDomAdapter(document);
    const listener = vi.fn();
    const release = dom.subscribeLayout(listener);
    await paint();
    const scan = vi.spyOn(document, "querySelectorAll");

    const editor = document.querySelector(".editor")!;
    for (const character of "net = sales") {
      editor.append(Object.assign(document.createElement("span"), { textContent: character }));
      await paint();
    }

    expect(scan).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    release();
  });

  test("keeps notifying while any layout subscriber remains", async () => {
    vi.useFakeTimers();
    const dom = new NotebookDomAdapter(document);
    const appendOutput = async (id: string) => {
      document.body.append(Object.assign(document.createElement("div"), { id }));
      await paint();
    };
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = dom.subscribeLayout(first);
    const releaseSecond = dom.subscribeLayout(second);

    releaseFirst();
    await appendOutput("output-a");
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();

    releaseSecond();
    const third = vi.fn();
    const releaseThird = dom.subscribeLayout(third);
    await appendOutput("output-b");
    expect(third).toHaveBeenCalled();
    releaseThird();
  });

  test("attaches frames inside the targets a new selector configures", () => {
    document.body.innerHTML =
      '<div id="output-chart"><section class="chart"><iframe></iframe></section></div>';
    const section = document.querySelector<HTMLElement>(".chart")!;
    section.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    const frame = document.querySelector("iframe")!;
    const dom = new NotebookDomAdapter(document);
    const frames: (HTMLIFrameElement | null)[] = [];
    const stop = dom.observeInteractionSurfaces(
      { includeTargetFrames: true, lockSelectionGestures: true },
      (surface) => {
        frames.push(surface.frame);
        return () => {};
      },
    );
    expect(frames).not.toContain(frame);

    dom.setSelector(".chart");
    dom.publishSelector();

    expect(frames).toContain(frame);
    stop();
  });

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
    const ResizeObserverStub = vi.fn(
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnectResize;
      },
    );
    vi.stubGlobal("MutationObserver", MutationObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const dom = new NotebookDomAdapter(document);

    const releaseFirst = dom.subscribeLayout(() => {});
    const resizeObservers = ResizeObserverStub.mock.calls.length;
    const releaseSecond = dom.subscribeLayout(() => {});

    expect(MutationObserverStub).toHaveBeenCalledOnce();
    expect(ResizeObserverStub).toHaveBeenCalledTimes(resizeObservers);

    releaseFirst();
    expect(disconnectMutation).not.toHaveBeenCalled();
    expect(disconnectResize).not.toHaveBeenCalled();

    releaseSecond();
    expect(disconnectMutation).toHaveBeenCalledOnce();
    expect(disconnectResize).toHaveBeenCalledTimes(resizeObservers);
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

function resizeEntry(target: Element): ResizeObserverEntry {
  return {
    target,
    contentRect: new DOMRect(),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
}

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
