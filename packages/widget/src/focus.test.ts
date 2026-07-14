import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { focusDock, focusSelectionOrDock } from "@/focus";

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("focus restoration", () => {
  test("returns to the marker when it remains mounted", () => {
    const dock = document.createElement("button");
    dock.setAttribute("data-ml-select", "");
    const marker = document.createElement("button");
    marker.setAttribute("data-marimo-lens-selection-id", "selection-1");
    document.body.append(dock, marker);

    focusSelectionOrDock("selection-1");

    expect(document.activeElement).toBe(marker);
  });

  test("returns to the stable Select control after removal", () => {
    const dock = document.createElement("button");
    dock.setAttribute("data-ml-select", "");
    document.body.appendChild(dock);

    focusDock();

    expect(document.activeElement).toBe(dock);
  });

  test("does not let a stale frame target a later Lens instance", () => {
    let scheduled: FrameRequestCallback | undefined;
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      scheduled = callback;
      return 1;
    });

    focusDock();
    const laterDock = document.createElement("button");
    laterDock.setAttribute("data-ml-select", "");
    document.body.appendChild(laterDock);
    scheduled?.(0);

    expect(document.activeElement).not.toBe(laterDock);
  });
});
