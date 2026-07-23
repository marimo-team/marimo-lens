import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { focusDock, focusSelectionOrDock } from "@/ui/focus";

let dom: NotebookDomAdapter;

beforeEach(() => {
  dom = new NotebookDomAdapter(document);
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

    focusSelectionOrDock(dom, "selection-1");

    expect(document.activeElement).toBe(marker);
  });

  test("returns to the stable Select control after removal", () => {
    const container = document.createElement("aside");
    container.setAttribute("data-marimo-lens-dock", "");
    const dock = document.createElement("button");
    dock.setAttribute("data-ml-select", "");
    container.appendChild(dock);
    document.body.appendChild(container);

    focusDock(dom);

    expect(document.activeElement).toBe(dock);
  });

  test("does not let a stale frame target a later Lens instance", () => {
    let scheduled: FrameRequestCallback | undefined;
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      scheduled = callback;
      return 1;
    });

    focusDock(dom);
    const container = document.createElement("aside");
    container.setAttribute("data-marimo-lens-dock", "");
    const laterDock = document.createElement("button");
    laterDock.setAttribute("data-ml-select", "");
    container.appendChild(laterDock);
    document.body.appendChild(container);
    scheduled?.(0);

    expect(document.activeElement).not.toBe(laterDock);
  });

  test("does not let stale selection focus target a replacement marker", () => {
    let scheduled: FrameRequestCallback | undefined;
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      scheduled = callback;
      return 1;
    });
    const original = document.createElement("button");
    original.setAttribute("data-marimo-lens-selection-id", "selection-1");
    document.body.appendChild(original);

    focusSelectionOrDock(dom, "selection-1");
    original.remove();
    const replacement = document.createElement("button");
    replacement.setAttribute("data-marimo-lens-selection-id", "selection-1");
    document.body.appendChild(replacement);
    scheduled?.(0);

    expect(document.activeElement).not.toBe(replacement);
  });

  test("returns to the collapsed Lens tab after a selection disappears", () => {
    const dock = document.createElement("aside");
    dock.setAttribute("data-marimo-lens-dock", "");
    const tab = document.createElement("button");
    tab.setAttribute("data-ml-dock-tab", "");
    dock.appendChild(tab);
    document.body.appendChild(dock);

    focusSelectionOrDock(dom, "selection-1");

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

    focusSelectionOrDock(dom, "selection-1");

    expect(document.activeElement).toBe(enabled);
  });

  test("restores focus inside the mounted notebook document", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const secondaryDocument = frame.contentDocument!;
    const primary = document.createElement("button");
    primary.setAttribute("data-marimo-lens-selection-id", "selection-1");
    document.body.appendChild(primary);
    const secondary = secondaryDocument.createElement("button");
    secondary.setAttribute("data-marimo-lens-selection-id", "selection-1");
    secondary.focus = vi.fn();
    secondaryDocument.body.appendChild(secondary);
    vi.spyOn(frame.contentWindow!, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    focusSelectionOrDock(new NotebookDomAdapter(secondaryDocument), "selection-1");

    expect(secondary.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(primary);
  });
});
