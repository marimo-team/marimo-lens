import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { useViewportRevision } from "@/viewport";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("viewport revision", () => {
  test("invalidates marker positions when surrounding DOM shifts", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<ViewportProbe />));
    expect(container.textContent).toBe("0");

    await act(async () => {
      document.body.prepend(document.createElement("section"));
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });

    expect(Number(container.textContent)).toBeGreaterThan(0);
  });
});

function ViewportProbe() {
  return <span>{useViewportRevision()}</span>;
}
