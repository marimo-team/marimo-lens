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
    const container = document.createElement("aside");
    container.setAttribute("data-marimo-lens-dock", "");
    const dock = document.createElement("button");
    dock.setAttribute("data-ml-select", "");
    container.appendChild(dock);
    document.body.appendChild(container);

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
    const container = document.createElement("aside");
    container.setAttribute("data-marimo-lens-dock", "");
    const laterDock = document.createElement("button");
    laterDock.setAttribute("data-ml-select", "");
    container.appendChild(laterDock);
    document.body.appendChild(container);
    scheduled?.(0);

    expect(document.activeElement).not.toBe(laterDock);
  });

  test("returns to the collapsed Lens tab after a selection disappears", () => {
    const dock = document.createElement("aside");
    dock.setAttribute("data-marimo-lens-dock", "");
    const tab = document.createElement("button");
    tab.setAttribute("data-ml-dock-tab", "");
    dock.appendChild(tab);
    document.body.appendChild(dock);

    focusSelectionOrDock("selection-1");

    expect(document.activeElement).toBe(tab);
  });

  test("returns to the first enabled dock control when Lens is expanded", () => {
    const dock = document.createElement("aside");
    dock.setAttribute("data-marimo-lens-dock", "");
    const disabled = document.createElement("button");
    disabled.disabled = true;
    const enabled = document.createElement("button");
    dock.append(disabled, enabled);
    document.body.appendChild(dock);

    focusSelectionOrDock("selection-1");

    expect(document.activeElement).toBe(enabled);
  });
});
