import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { useViewportRevision } from "@/notebook/use-viewport-revision";
import { intersectBounds } from "@/notebook/viewport";

import { NotebookDomTestProvider } from "../support/notebook-dom";
import { render } from "../support/render";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("viewport revision", () => {
  test("invalidates marker positions when surrounding DOM shifts", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));

    const { container } = render(
      <NotebookDomTestProvider>
        <ViewportProbe />
      </NotebookDomTestProvider>,
    );
    expect(container.textContent).toBe("0");

    act(() => document.body.prepend(document.createElement("section")));

    await vi.waitFor(() => expect(Number(container.textContent)).toBeGreaterThan(0));
  });
});

describe("viewport geometry", () => {
  test("intersects rectangles and rejects edge contact", () => {
    const viewport = new DOMRect(100, 50, 500, 400);
    expect(intersectBounds(new DOMRect(50, 100, 200, 100), viewport)).toEqual({
      left: 100,
      top: 100,
      right: 250,
      bottom: 200,
      width: 150,
      height: 100,
    });
    expect(intersectBounds(new DOMRect(0, 50, 100, 100), viewport)).toBeNull();
  });
});

function ViewportProbe() {
  return <span>{useViewportRevision()}</span>;
}
