import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { Selection } from "@/contracts";

import { SelectionNoteEditor } from "@/components/selection-note-editor";
import { selectionFixture } from "@/test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("selection note editor", () => {
  test("keeps the note optional", () => {
    const onSave = vi.fn<(note: string) => void>();
    renderEditor(selectionFixture({ note: "" }), onSave);

    const done = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Done",
    );
    expect(done?.disabled).toBe(false);
    act(() => done?.click());
    expect(onSave).toHaveBeenCalledWith("");
  });

  test("preserves local typing while the snapshot state changes", () => {
    const onSave = vi.fn<(note: string) => void>();
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    renderEditor(selection, onSave);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => setTextareaValue(textarea, "Compare this peak with the threshold"));

    act(() => {
      root?.render(
        editor(
          {
            ...selection,
            snapshot: {
              status: "failed",
              capturedAt: "2026-07-14T12:00:00Z",
            },
          },
          onSave,
        ),
      );
    });

    expect(textarea.value).toBe("Compare this peak with the threshold");
    expect(document.body.textContent).toContain("Snapshot unavailable. Text context is ready.");
  });

  test("offers an explicit refresh for an outdated snapshot", () => {
    const onRetrySnapshot = vi.fn();
    renderEditor(
      selectionFixture({
        snapshot: {
          status: "outdated",
          id: "snapshot-1",
          mediaType: "image/png",
          width: 800,
          height: 600,
          sha256: "a".repeat(64),
          capturedAt: "2026-07-14T12:00:00Z",
        },
      }),
      () => {},
      { onRetrySnapshot },
    );

    const refresh = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Refresh snapshot"),
    );
    act(() => refresh?.click());
    expect(onRetrySnapshot).toHaveBeenCalledOnce();
  });
});

function renderEditor(
  selection: Selection,
  onSave: (note: string) => void,
  overrides: Partial<React.ComponentProps<typeof SelectionNoteEditor>> = {},
) {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
  const container = document.createElement("div");
  document.body.append(output, container);
  root = createRoot(container);
  act(() => root?.render(editor(selection, onSave, overrides)));
}

function editor(
  selection: Selection,
  onSave: (note: string) => void,
  overrides: Partial<React.ComponentProps<typeof SelectionNoteEditor>> = {},
) {
  return (
    <SelectionNoteEditor
      selection={selection}
      note={selection.note}
      saving={false}
      mutationPending={false}
      motion="instant"
      capturingSnapshot={selection.snapshot.status === "pending"}
      onSave={onSave}
      onCancel={() => {}}
      onDelete={() => {}}
      {...overrides}
    />
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
