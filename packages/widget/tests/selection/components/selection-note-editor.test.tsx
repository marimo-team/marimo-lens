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

  test("shows the selection kind without an image status row", () => {
    renderEditor(selectionFixture(), () => {});

    expect(document.querySelector('[aria-label="Point selection"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Image ready");
  });

  test("shows the region selection mark", () => {
    renderEditor(
      selectionFixture({
        anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.4, height: 0.3 },
      }),
      () => {},
    );

    expect(document.querySelector('[aria-label="Region selection"]')).not.toBeNull();
  });

  test("positions the editor from the selected output anchor", () => {
    renderEditor(selectionFixture(), () => {});

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.dataset.placement).toBe("below");
    expect(editor.style.left).toBe("12px");
    expect(editor.style.top).toBe("138px");
    expect(editor.style.width).toBe("352px");
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
