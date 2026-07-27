import type { Selection } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";

import { selectionFixture } from "../../support/fixtures";

let root: Root | null = null;
let notebookDom: NotebookDomAdapter | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  notebookDom?.dispose();
  notebookDom = null;
  document.body.replaceChildren();
  vi.useRealTimers();
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

  test("preserves local typing while the selection state changes", () => {
    const onSave = vi.fn<(note: string) => void>();
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    renderEditor(selection, onSave);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => setTextareaValue(textarea, "Compare this peak with the threshold"));

    act(() => {
      root?.render(
        withNotebookDom(
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
        ),
      );
    });

    expect(textarea.value).toBe("Compare this peak with the threshold");
  });

  test("opens as a focused note form with compact cell metadata", () => {
    const selection = selectionFixture({ note: "Compare these values" });
    renderEditor(selection, () => {});

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(editor.querySelector(".ml-note-editor__header")?.textContent).toBe("S1·Cell cell-1");
    expect(textarea.placeholder).toBe("Add a note (optional)");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(selection.note.length);
    expect(editor.querySelector('button[title="View image"]')).toBeNull();
    expect(editor.querySelector('[aria-label="Point selection"]')).not.toBeNull();
  });

  test("identifies a region selection in the metadata row", () => {
    renderEditor(
      selectionFixture({
        anchor: { kind: "rect", x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      }),
      () => {},
    );

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.querySelector('[aria-label="Region selection"]')).not.toBeNull();
  });

  test("anchors a region editor to the region origin", () => {
    renderEditor(
      selectionFixture({
        anchor: { kind: "rect", x: 0.8, y: 0.2, width: 0.1, height: 0.3 },
      }),
      () => {},
    );

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.style.left).toBe("160px");
  });

  test("keeps cancel, save, and removal available as the editor actions", () => {
    const onCancel = vi.fn();
    renderEditor(selectionFixture(), () => {}, { onCancel });

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.querySelector('button[aria-label="Remove selection S1"]')).not.toBeNull();
    const cancel = Array.from(editor.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Cancel",
    );
    act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test("keeps the draft open and returns focus after an outside press", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    renderEditor(selectionFixture({ note: "Keep this draft" }), () => {}, { onCancel });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      vi.runAllTimers();
    });

    expect(document.querySelector("[data-marimo-lens-note-editor]")).not.toBeNull();
    expect(textarea.value).toBe("Keep this draft");
    expect(document.activeElement).toBe(textarea);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("positions the editor from the selected output anchor", () => {
    renderEditor(selectionFixture(), () => {});

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.dataset.placement).toBe("below");
    expect(editor.style.left).toBe("12px");
    expect(editor.style.top).toBe("140px");
    expect(editor.style.width).toBe("320px");
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
  notebookDom = new NotebookDomAdapter(document);
  root = createRoot(container);
  act(() => root?.render(withNotebookDom(editor(selection, onSave, overrides))));
}

function editor(
  selection: Selection,
  onSave: (note: string) => void,
  overrides: Partial<React.ComponentProps<typeof SelectionNoteEditor>> = {},
) {
  return (
    <SelectionNoteEditor
      selection={selection}
      initialNote={selection.note}
      saving={false}
      mutationPending={false}
      motion="instant"
      onSave={onSave}
      onCancel={() => {}}
      onDelete={() => {}}
      {...overrides}
    />
  );
}

function withNotebookDom(children: React.ReactNode) {
  if (!notebookDom) throw new Error("Notebook DOM fixture is unavailable");
  return <NotebookDomProvider adapter={notebookDom}>{children}</NotebookDomProvider>;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
