import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { AnchoredSurfaceAnchor } from "@/ui/anchored-surface";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";
import { useAnchoredSurface } from "@/ui/anchored-surface";

let root: Root | null = null;
const adapters = new Set<NotebookDomAdapter>();
const releases = new Set<() => void>();

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  for (const release of releases) release();
  releases.clear();
  for (const adapter of adapters) adapter.dispose();
  adapters.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("anchored surfaces", () => {
  test("clamps the surface and follows its anchor on scroll", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const anchorElement = document.createElement("button");
    document.body.appendChild(anchorElement);
    let rect = new DOMRect(290, 400, 20, 20);

    renderProbe(anchorElement, () => rect);

    const surface = document.querySelector<HTMLOutputElement>("[data-test-surface]")!;
    expect(surface.dataset.placement).toBe("above");
    expect(surface.style.left).toBe("44px");
    expect(surface.style.bottom).toBe("210px");
    expect(surface.style.width).toBe("264px");

    rect = new DOMRect(40, 100, 20, 20);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    act(() => frames.shift()?.(0));

    expect(surface.dataset.placement).toBe("below");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.top).toBe("130px");
  });

  test("subscribes through the anchor element's owner window", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow;
    if (!ownerDocument || !ownerWindow) throw new Error("Iframe document must be available");
    const anchorElement = ownerDocument.createElement("button");
    ownerDocument.body.appendChild(anchorElement);
    const ownerAdd = vi.spyOn(ownerWindow, "addEventListener");
    const ownerRemove = vi.spyOn(ownerWindow, "removeEventListener");
    const primaryAdd = vi.spyOn(window, "addEventListener");

    renderProbe(anchorElement, () => new DOMRect(40, 100, 20, 20));

    expect(ownerAdd).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(ownerAdd).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(primaryAdd).not.toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => root?.unmount());
    root = null;
    expect(ownerRemove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(ownerRemove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
  });

  test.each([
    ["top-left", new DOMRect(300, 20, 20, 20)],
    ["bottom-right", new DOMRect(1_250, 670, 20, 20)],
  ])("keeps an anchored surface inside the marimo app pane at %s", (_, anchorRect) => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 40, 900, 640);
    const widget = document.createElement("marimo-anywidget");
    const shadow = widget.attachShadow({ mode: "open" });
    const host = document.createElement("span");
    const anchor = document.createElement("button");
    shadow.append(host, anchor);
    app.append(widget);
    document.body.append(app);

    const surfaceHeight = 120;
    renderProbe(anchor, () => anchorRect, host, surfaceHeight);

    const surface = document.querySelector<HTMLOutputElement>("[data-test-surface]")!;
    const left = Number.parseFloat(surface.style.left);
    const width = Number.parseFloat(surface.style.width);
    const top = surface.style.top
      ? Number.parseFloat(surface.style.top)
      : window.innerHeight - Number.parseFloat(surface.style.bottom) - surfaceHeight;
    expect({
      left: left >= 332,
      right: left + width <= 1_208,
      top: top >= 52,
      bottom: top + surfaceHeight <= 668,
    }).toEqual({ left: true, right: true, top: true, bottom: true });
  });

  test("places an unanchored surface relative to the marimo app pane", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_280);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    const app = document.createElement("main");
    app.id = "App";
    app.getBoundingClientRect = () => new DOMRect(320, 40, 900, 640);
    const host = document.createElement("span");
    app.append(host);
    document.body.append(app);

    renderProbe(null, () => new DOMRect(), host);

    const surface = document.querySelector<HTMLOutputElement>("[data-test-surface]")!;
    expect({ right: surface.style.right, bottom: surface.style.bottom }).toEqual({
      right: "76px",
      bottom: "112px",
    });
  });
});

function renderProbe(
  element: Element | null,
  getRect: () => DOMRectReadOnly,
  host: Element | null = null,
  surfaceHeight?: number,
): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const adapter = new NotebookDomAdapter(element?.ownerDocument ?? document);
  if (host) releases.add(adapter.registerHost(host));
  adapters.add(adapter);
  root = createRoot(container);
  act(() =>
    root?.render(
      <NotebookDomProvider adapter={adapter}>
        <SurfaceProbe element={element} getRect={getRect} surfaceHeight={surfaceHeight} />
      </NotebookDomProvider>,
    ),
  );
}

function SurfaceProbe({
  element,
  getRect,
  surfaceHeight,
}: {
  element: Element | null;
  getRect: () => DOMRectReadOnly;
  surfaceHeight?: number;
}) {
  const anchor: AnchoredSurfaceAnchor | null = element && { element, rect: getRect() };
  const position = useAnchoredSurface({
    anchor,
    open: true,
    preferredPlacement: anchor && anchor.rect.top < 160 ? "below" : "above",
    gap: 10,
    width: 264,
    surfaceHeight,
    fallback: { inset: { right: 16, bottom: 72 }, placement: "above" },
  });
  return <output data-test-surface data-placement={position.placement} style={position.style} />;
}
