import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { LensDock } from "@/ui/components/lens-dock";
import { LensStatus } from "@/ui/components/lens-status";

import { selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";

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
    const onEditNote = vi.fn();
    const snapshotLoader = new SelectionSnapshotLoader(async () => {
      throw new Error("Snapshot loading is not expected in this test");
    });
    root = createRoot(container);

    act(() => {
      root?.render(
        <NotebookDomTestProvider>
          <LensDock
            selections={[selection]}
            history={[]}
            currentSelectionId={selection.id}
            availableOutputCellIds={new Set([selection.outputCellId])}
            armed={false}
            listOpen
            sheetTab="open"
            focusedHistoryRevision={null}
            clearPending={false}
            historyClearPending={false}
            capturingSelectionIds={new Set()}
            busySelectionIds={new Set()}
            interactionLocked={false}
            onToggleArmed={() => {}}
            onToggleList={() => {}}
            onSheetTabChange={() => {}}
            onOpenHistory={() => {}}
            onClearSelections={() => {}}
            onClearHistory={() => {}}
            onReopenSelection={() => {}}
            onActivateSelection={onActivate}
            onEditNote={() => {}}
            onDeleteSelection={() => {}}
            snapshotLoader={snapshotLoader}
          />
          <SelectionNoteEditor
            selection={selection}
            initialNote={selection.note}
            saving={false}
            mutationPending={false}
            motion="instant"
            onSave={() => {}}
            onCancel={() => {}}
            onDelete={() => {}}
          />
          <SelectionOverlay
            selections={[selection]}
            currentSelectionId={selection.id}
            availableOutputCellIds={new Set([selection.outputCellId])}
            workflow={{ mode: "idle" }}
            busySelectionIds={new Set()}
            capturingSelectionIds={new Set()}
            onActivate={onActivate}
            onEditNote={onEditNote}
            onReposition={() => {}}
            registerAdjustment={() => {}}
            releaseAdjustment={() => {}}
          />
          <LensStatus message="Ready" />
        </NotebookDomTestProvider>,
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
    expect(onEditNote).toHaveBeenCalledWith(selection, "instant");
  });
});
