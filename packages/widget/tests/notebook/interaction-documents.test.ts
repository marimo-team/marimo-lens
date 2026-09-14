import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { observeInteractionSurfaces, parentViewportPoint } from "@/notebook/interaction-documents";

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

describe("interaction documents", () => {
  test.each([
    {
      name: "non-uniform scaling",
      layout: { width: 400, height: 200 },
      rendered: { width: 200, height: 400 },
      expected: { x: 111, y: 76 },
    },
    {
      name: "unavailable layout dimensions",
      layout: { width: 0, height: 0 },
      rendered: { width: 200, height: 400 },
      expected: { x: 122, y: 63 },
    },
  ])("maps iframe coordinates with $name", ({ layout, rendered, expected }) => {
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => new DOMRect(100, 50, rendered.width, rendered.height);
    Object.defineProperties(frame, {
      offsetWidth: { configurable: true, value: layout.width },
      offsetHeight: { configurable: true, value: layout.height },
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 3 },
    });
    const event = new PointerEvent("pointermove", { clientX: 20, clientY: 10 });

    expect(parentViewportPoint(event, frame)).toEqual(expected);
  });

  test("coalesces frame discovery and retains document listeners until disposal", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const output = document.createElement("div");
    const frame = document.createElement("iframe");
    output.append(frame);
    document.body.append(host, output);
    const controls = document.createElement("nav");
    controls.dataset.marimoLensUi = "";
    host.attachShadow({ mode: "open" }).append(controls);
    const roots = vi.fn(() => [output]);
    const detachOwner = vi.fn();
    const detachFrame = vi.fn();
    const attach = vi.fn((surface: { frame: HTMLIFrameElement | null }) =>
      surface.frame ? detachFrame : detachOwner,
    );
    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: roots,
      },
      attach,
    );
    await paint();
    roots.mockClear();
    controls.append(document.createElement("button"));
    await paint();
    expect(roots).not.toHaveBeenCalled();

    host.dataset.progress = "reading";
    await Promise.resolve();
    output.append(document.createElement("span"));
    await Promise.resolve();
    expect(roots).not.toHaveBeenCalled();
    await paint();
    expect(roots).toHaveBeenCalledOnce();
    expect(attach.mock.calls.map(([surface]) => surface.frame)).toEqual([null, frame]);
    expect(detachOwner).not.toHaveBeenCalled();
    expect(detachFrame).not.toHaveBeenCalled();
    dispose();
    expect(detachOwner).toHaveBeenCalledOnce();
    expect(detachFrame).toHaveBeenCalledOnce();
  });

  test("refreshes frame eligibility and navigation without rescanning unchanged structure", async () => {
    vi.useFakeTimers();
    const output = document.createElement("div");
    const frame = document.createElement("iframe");
    output.append(frame);
    document.body.append(output);
    const query = vi.spyOn(document, "querySelectorAll");
    const detach = vi.fn();
    const attach = vi.fn(() => detach);
    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: () => (output.className === "selected" ? [output] : []),
      },
      attach,
    );
    expect(attach).toHaveBeenCalledTimes(1);
    query.mockClear();
    output.className = "selected";
    await paint();
    expect(attach).toHaveBeenLastCalledWith({ document: frame.contentDocument, frame });
    const nextDocument = document.implementation.createHTMLDocument("navigated");
    Object.defineProperty(frame, "contentDocument", { configurable: true, value: nextDocument });
    frame.dispatchEvent(new Event("load"));
    await paint();
    expect(detach).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenLastCalledWith({ document: nextDocument, frame });
    expect(query).not.toHaveBeenCalled();
    dispose();
  });

  test("discovers a newly attached shadow tree after a host attribute changes", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const attach = vi.fn(() => () => {});
    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: () => [host],
      },
      attach,
    );
    const shadow = host.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    const childDocument = document.implementation.createHTMLDocument("shadow frame");
    Object.defineProperty(frame, "contentDocument", { value: childDocument });
    shadow.append(frame);
    host.className = "ready";
    await paint();
    expect(attach).toHaveBeenLastCalledWith({ document: childDocument, frame });
    dispose();
  });

  test("discovers dynamically added output frames while gesture locking is off", async () => {
    vi.useFakeTimers();
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.style.setProperty("touch-action", "pan-y");
    document.body.appendChild(output);
    const attachedDocuments: Document[] = [];
    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: () => [output],
      },
      (surface) => {
        attachedDocuments.push(surface.document);
        return () => {};
      },
    );
    expect(attachedDocuments).toEqual([document]);

    const frame = document.createElement("iframe");
    output.appendChild(frame);
    frame.contentDocument?.documentElement.style.setProperty("touch-action", "manipulation");
    await paint();

    expect(attachedDocuments).toEqual([document, frame.contentDocument]);
    expect(output.style.getPropertyValue("touch-action")).toBe("pan-y");
    expect(frame.contentDocument?.documentElement.style.getPropertyValue("touch-action")).toBe(
      "manipulation",
    );

    dispose();
  });

  test("releases a removed shadow root while continuing to observe the live document", () => {
    const observed = new Set<Node>();
    let notifyMutation: ((root: Node) => void) | undefined;
    vi.stubGlobal(
      "MutationObserver",
      vi.fn(
        class implements MutationObserver {
          constructor(callback: MutationCallback) {
            notifyMutation = (root) => {
              if (observed.has(root)) callback([], this);
            };
          }

          observe = vi.fn((root: Node) => observed.add(root));
          disconnect = () => observed.clear();
          takeRecords = () => [];
        },
      ),
    );
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);

    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: () => [],
      },
      () => () => {},
    );
    host.remove();
    notifyMutation?.(document.body);
    const pending = [...frames.entries()][0];
    if (!pending) throw new Error("Shadow-root removal did not schedule a topology refresh");
    frames.delete(pending[0]);
    pending[1](0);

    notifyMutation?.(shadow);
    expect(frames.size).toBe(0);
    notifyMutation?.(document.body);
    expect(frames.size).toBe(1);

    dispose();
  });

  test("locks the resolved surface of a marimo island while selection is armed", () => {
    const island = document.createElement("marimo-island");
    island.setAttribute("data-cell-id", "island-cell");
    const output = document.createElement("div");
    output.className = "output";
    output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 4);
    const content = document.createElement("div");
    content.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    output.appendChild(content);
    island.appendChild(output);
    document.body.appendChild(island);

    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: true,
        targetRoots: () => [content],
      },
      () => () => {},
    );

    expect(content.style.getPropertyValue("touch-action")).toBe("none");
    expect(content.style.getPropertyPriority("touch-action")).toBe("important");

    dispose();
    expect(content.style.getPropertyValue("touch-action")).toBe("");
  });

  test("observes frames across an open shadow tree in a generic target root", () => {
    const target = document.createElement("section");
    target.style.setProperty("touch-action", "pan-y");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    const frameDocument = document.implementation.createHTMLDocument("frame");
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: frameDocument,
    });
    shadow.appendChild(frame);
    target.appendChild(host);
    document.body.appendChild(target);
    const attachedDocuments: Document[] = [];

    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: true,
        targetRoots: () => [target],
      },
      (surface) => {
        attachedDocuments.push(surface.document);
        return () => {};
      },
    );

    expect(attachedDocuments).toEqual([document, frameDocument]);
    expect(target.style.getPropertyValue("touch-action")).toBe("none");
    expect(frameDocument.documentElement.style.getPropertyValue("touch-action")).toBe("none");

    dispose();
    expect(target.style.getPropertyValue("touch-action")).toBe("pan-y");
  });

  test("marks an inaccessible frame across an open shadow tree as a pointer boundary", () => {
    const target = document.createElement("section");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
    shadow.appendChild(frame);
    target.appendChild(host);
    document.body.appendChild(target);

    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: true,
        targetRoots: () => [target],
      },
      () => () => {},
    );

    expect(frame.dataset.marimoLensPointerBoundary).toBe("true");
    expect(frame.style.getPropertyValue("pointer-events")).toBe("none");

    dispose();
    expect(frame.dataset.marimoLensPointerBoundary).toBeUndefined();
    expect(frame.style.getPropertyValue("pointer-events")).toBe("");
  });
});
