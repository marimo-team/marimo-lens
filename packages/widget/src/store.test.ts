import { beforeEach, describe, expect, test } from "vite-plus/test";

import type { LensTarget, ResolvedHover } from "@/types";

import { chartTarget, dataframeTarget } from "@/selection/selection-registry-fixtures";
import { createLensUiStore } from "@/store";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function resolvedHover(target: LensTarget, kind = "target"): ResolvedHover {
  const element = document.createElement("div");
  const rect = new DOMRect(10, 20, 120, 32);
  return {
    element,
    rect,
    target,
    semanticSelection: {
      id: `${target.id}:${kind}`,
      targetId: target.id,
      kind,
      granularity: kind === "target" ? "target" : "item",
      label: `${target.label ?? target.id} ${kind}`,
      evidence: [],
      highlight: { kind: "element", element },
      anchor: { element },
    },
    chartPart: null,
    context: {},
    displayCellId: null,
    elementName: "div",
    elementPath: "div",
    selection: { adapter: "selector", kind },
  };
}

describe("settings store", () => {
  test("defaults to Standard copy detail without a theme override", () => {
    const store = createLensUiStore("test-default-position", "test-default-settings");

    expect(store.getState().outputDetail).toBe("standard");
    expect(store.getState().theme).toBeNull();
  });

  test("persists the selected theme with copy detail", () => {
    const settingsKey = "test-theme-settings";
    const store = createLensUiStore("test-theme-position", settingsKey);

    store.getState().setTheme("light");
    store.getState().setOutputDetail("detailed");

    expect(JSON.parse(window.localStorage.getItem(settingsKey) ?? "{}")).toEqual({
      outputDetail: "detailed",
      theme: "light",
    });
    expect(createLensUiStore("test-theme-position-2", settingsKey).getState()).toMatchObject({
      outputDetail: "detailed",
      theme: "light",
    });
  });

  test("falls back to Standard copy detail for invalid stored settings", () => {
    const settingsKey = "test-invalid-settings";
    window.localStorage.setItem(
      settingsKey,
      JSON.stringify({ outputDetail: "verbose", theme: "sepia" }),
    );

    expect(createLensUiStore("test-invalid-position", settingsKey).getState()).toMatchObject({
      outputDetail: "standard",
      theme: null,
    });
  });

  test("toggles feedback marker visibility without persisting it", () => {
    const store = createLensUiStore("test-marker-toggle", "test-marker-settings");

    expect(store.getState().markersVisible).toBe(true);

    store.getState().toggleMarkersVisible();
    expect(store.getState().markersVisible).toBe(false);

    store.getState().setMarkersVisible(true);
    expect(store.getState().markersVisible).toBe(true);

    expect(
      createLensUiStore("test-marker-toggle-2", "test-marker-settings").getState(),
    ).toMatchObject({
      markersVisible: true,
    });
  });

  test("keeps target inventory behind an explicit dock toggle", () => {
    const store = createLensUiStore("test-inventory-toggle");

    expect(store.getState()).toMatchObject({
      inventoryOpen: false,
      open: false,
      settingsOpen: false,
    });

    store.getState().toggleOpen();
    expect(store.getState()).toMatchObject({
      inventoryOpen: false,
      open: true,
      settingsOpen: false,
    });

    store.getState().toggleInventory();
    expect(store.getState()).toMatchObject({
      inventoryOpen: true,
      open: true,
      settingsOpen: false,
    });

    store.getState().toggleSettings();
    expect(store.getState()).toMatchObject({
      inventoryOpen: false,
      open: true,
      settingsOpen: true,
    });

    store.getState().toggleInventory();
    expect(store.getState()).toMatchObject({
      inventoryOpen: true,
      open: true,
      settingsOpen: false,
    });

    store.getState().toggleOpen();
    expect(store.getState()).toMatchObject({
      inventoryOpen: false,
      open: false,
      settingsOpen: false,
    });
  });
});

describe("copy status store", () => {
  test("does not let an old success reset clear a newer pending copy", () => {
    const store = createLensUiStore("test-copy-status");

    store.getState().startCopy("copy-1", 1);
    store.getState().copySucceeded(2);
    store.getState().startCopy("copy-2", 2);
    store.getState().resetCopyStatus(2);

    expect(store.getState()).toMatchObject({
      copyRequestId: "copy-2",
      copyStartedRevision: 2,
      copyStatus: "pending",
      copied: false,
    });
  });

  test("only resets the matching successful revision", () => {
    const store = createLensUiStore("test-copy-status-revision");

    store.getState().startCopy("copy-1", 1);
    store.getState().copySucceeded(2);
    store.getState().resetCopyStatus(1);
    expect(store.getState().copyStatus).toBe("success");

    store.getState().resetCopyStatus(2);
    expect(store.getState().copyStatus).toBe("idle");
  });
});

describe("target selection store", () => {
  test("keeps a clicked target selected after transient preview clears", () => {
    const store = createLensUiStore("test-selected-target");
    const targetSelection = resolvedHover(dataframeTarget);
    const transientPreview = resolvedHover(chartTarget);

    store.getState().setSelectedHover(targetSelection);
    store.getState().setHover(transientPreview);
    expect(store.getState().hover).toBe(transientPreview);

    store.getState().setHover(null);
    expect(store.getState().selectedHover).toBe(targetSelection);

    store.getState().resetInteraction();
    expect(store.getState()).toMatchObject({
      armed: false,
      hover: null,
      inventoryOpen: false,
      popup: null,
      selectedHover: targetSelection,
    });
  });

  test("updates the selected overlay when a precise semantic part opens a popup", () => {
    const store = createLensUiStore("test-selected-semantic-part");
    const targetSelection = resolvedHover(dataframeTarget);
    const semanticPartSelection = resolvedHover(chartTarget, "mark");

    store.getState().setSelectedHover(targetSelection);
    store.getState().setPopup({ hover: semanticPartSelection, x: 44, y: 55 });

    expect(store.getState().selectedHover).toBe(semanticPartSelection);
    expect(store.getState().popup?.hover).toBe(semanticPartSelection);
  });

  test("clears selected overlays when Lens closes", () => {
    const store = createLensUiStore("test-close-clears-selection");
    const targetSelection = resolvedHover(dataframeTarget);

    store.getState().toggleOpen();
    store.getState().setSelectedHover(targetSelection);
    store.getState().toggleOpen();

    expect(store.getState()).toMatchObject({
      armed: false,
      hover: null,
      inventoryOpen: false,
      open: false,
      popup: null,
      selectedHover: null,
      settingsOpen: false,
    });
  });
});
