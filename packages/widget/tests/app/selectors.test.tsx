import { act } from "react";
import { describe, expect, test, vi } from "vite-plus/test";

import { LensDock } from "@/dock/lens-dock";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import { LensStatus } from "@/ui/components/lens-status";

import { outputFixture, selectionFixture } from "../support/fixtures";
import { LensTestProvider, lensState } from "../support/lens";
import { NotebookDomTestProvider } from "../support/notebook-dom";
import { render } from "../support/render";

describe("stable browser selectors", () => {
  test("exposes the selection-first interaction surface", () => {
    outputFixture("cell-1", new DOMRect(20, 20, 400, 240));
    const selection = selectionFixture();
    const onActivate = vi.fn();
    const onEditNote = vi.fn();
    const state = lensState({
      selections: [selection],
      currentSelectionId: selection.id,
      availableSelectionIds: new Set([selection.id]),
      sheet: { open: true },
    });

    render(
      <NotebookDomTestProvider>
        <LensTestProvider state={state}>
          <LensDock />
          <SelectionNoteEditor
            selection={selection}
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
            workflow={{ mode: "idle" }}
            busySelectionIds={new Set()}
            onActivate={onActivate}
            onEditNote={onEditNote}
            onReposition={() => {}}
            registerAdjustment={() => {}}
            releaseAdjustment={() => {}}
          />
          <LensStatus message="Ready" />
        </LensTestProvider>
      </NotebookDomTestProvider>,
    );

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
