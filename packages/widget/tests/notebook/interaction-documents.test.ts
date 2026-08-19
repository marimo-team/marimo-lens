import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { observeInteractionSurfaces, parentViewportPoint } from "@/notebook/interaction-documents";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("interaction documents", () => {
  test.each([
    { scale: 0.5, layout: { width: 400, height: 200 }, rendered: { width: 200, height: 100 } },
    { scale: 1, layout: { width: 200, height: 100 }, rendered: { width: 200, height: 100 } },
    { scale: 2, layout: { width: 100, height: 50 }, rendered: { width: 200, height: 100 } },
  ])("maps iframe coordinates at $scale× scale", ({ layout, rendered, scale }) => {
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => new DOMRect(100, 50, rendered.width, rendered.height);
    Object.defineProperties(frame, {
      offsetWidth: { configurable: true, value: layout.width },
      offsetHeight: { configurable: true, value: layout.height },
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 3 },
    });
    const event = new PointerEvent("pointermove", { clientX: 20, clientY: 10 });

    expect(parentViewportPoint(event, frame)).toEqual({
      x: 100 + (2 + 20) * scale,
      y: 50 + (3 + 10) * scale,
    });
  });

  test("coalesces topology changes without reinstalling document surfaces", () => {
    let notifyMutation = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      vi.fn(
        class implements MutationObserver {
          constructor(callback: MutationCallback) {
            notifyMutation = () => callback([], this);
          }

          observe = observe;
          disconnect = disconnect;
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
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });

    const output = document.createElement("div");
    output.id = "output-cell-1";
    const frame = document.createElement("iframe");
    output.appendChild(frame);
    document.body.appendChild(output);
    const query = vi.spyOn(document, "querySelectorAll");
    const detachOwner = vi.fn();
    const detachFrame = vi.fn();
    const attach = vi.fn(({ frame: ownerFrame }: { frame: HTMLIFrameElement | null }) =>
      ownerFrame ? detachFrame : detachOwner,
    );

    const dispose = observeInteractionSurfaces(
      document,
      {
        includeTargetFrames: true,
        lockSelectionGestures: true,
        targetRoots: () => [output],
      },
      attach,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(2);

    notifyMutation();
    notifyMutation();
    frame.dispatchEvent(new Event("load"));
    expect(query).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);

    const pending = [...frames.entries()][0];
    if (!pending) throw new Error("Topology refresh was not scheduled");
    frames.delete(pending[0]);
    pending[1](0);

    expect(query).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(detachOwner).not.toHaveBeenCalled();
    expect(detachFrame).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(detachOwner).toHaveBeenCalledOnce();
    expect(detachFrame).toHaveBeenCalledOnce();
  });

  test("discovers dynamically added output frames while gesture locking is off", () => {
    let notifyMutation = () => {};
    vi.stubGlobal(
      "MutationObserver",
      vi.fn(
        class implements MutationObserver {
          constructor(callback: MutationCallback) {
            notifyMutation = () => callback([], this);
          }

          observe = vi.fn();
          disconnect = vi.fn();
          takeRecords = () => [];
        },
      ),
    );
    let refresh: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      refresh = callback;
      return 1;
    });

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
    notifyMutation();
    refresh?.(0);

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
