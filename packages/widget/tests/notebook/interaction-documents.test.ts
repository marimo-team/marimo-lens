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
    const event = new MouseEvent("pointermove", { clientX: 20, clientY: 10 });

    expect(parentViewportPoint(event as PointerEvent, frame)).toEqual({
      x: 100 + (2 + 20) * scale,
      y: 50 + (3 + 10) * scale,
    });
  });

  test("coalesces topology changes without reinstalling document surfaces", () => {
    let notifyMutation: MutationCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      vi.fn(
        class {
          constructor(callback: MutationCallback) {
            notifyMutation = callback;
          }

          observe = observe;
          disconnect = disconnect;
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

    const dispose = observeInteractionSurfaces(document, true, attach);
    expect(query).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(2);

    notifyMutation?.([], {} as MutationObserver);
    notifyMutation?.([], {} as MutationObserver);
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

    const dispose = observeInteractionSurfaces(document, true, () => () => {});

    expect(content.style.getPropertyValue("touch-action")).toBe("none");
    expect(content.style.getPropertyPriority("touch-action")).toBe("important");

    dispose();
    expect(content.style.getPropertyValue("touch-action")).toBe("");
  });
});
