import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { LensDock } from "@/components/lens-dock";
import { LensStatus } from "@/components/lens-status";
import { SelectionNoteEditor } from "@/components/selection-note-editor";
import { SelectionOverlay } from "@/components/selection-overlay";
import { selectionFixture } from "@/test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("stable browser selectors", () => {
  test("exposes the selection-first interaction surface", () => {
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    document.body.appendChild(output);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const selection = selectionFixture();
    const onActivate = vi.fn();
    root = createRoot(container);

    act(() => {
      root?.render(
        <>
          <LensDock
            selections={[selection]}
            currentSelectionId={selection.id}
            armed={false}
            listOpen
            menuOpen={false}
            exportState={{ status: "idle" }}
            capturingSelectionIds={new Set()}
            busySelectionIds={new Set()}
            interactionLocked={false}
            onToggleArmed={() => {}}
            onToggleList={() => {}}
            onToggleMenu={() => {}}
            onCopyContext={() => {}}
            onClearSelections={() => {}}
            onActivateSelection={onActivate}
            onEditNote={() => {}}
            onDeleteSelection={() => {}}
            loadSnapshot={async () => {
              throw new Error("Snapshot loading is not expected in this test");
            }}
          />
          <SelectionNoteEditor
            selection={selection}
            note={selection.note}
            saving={false}
            mutationPending={false}
            motion="instant"
            capturingSnapshot={false}
            onSave={() => {}}
            onCancel={() => {}}
            onDelete={() => {}}
          />
          <SelectionOverlay
            selections={[selection]}
            currentSelectionId={selection.id}
            workflow={{ mode: "idle" }}
            busySelectionIds={new Set()}
            capturingSelectionIds={new Set()}
            onActivate={onActivate}
            onEditNote={() => {}}
            loadSnapshot={async () => {
              throw new Error("Snapshot loading is not expected in this test");
            }}
            onReposition={() => {}}
            registerAdjustment={() => {}}
            releaseAdjustment={() => {}}
          />
          <LensStatus message="Ready" />
        </>,
      );
    });

    expect(document.querySelector("[data-marimo-lens-dock]")).not.toBeNull();
    expect(document.querySelector("[data-ml-select]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-selection-list]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-note-editor]")).not.toBeNull();
    expect(document.querySelector('[data-marimo-lens-selection-id="selection-1"]')).not.toBeNull();
    expect(document.querySelector("output[data-marimo-lens-status]")?.textContent).toBe("Ready");

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    act(() => marker?.click());
    expect(onActivate).toHaveBeenCalledWith(selection);
  });
});
