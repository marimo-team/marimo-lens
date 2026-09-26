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
  vi.restoreAllMocks();
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

  test("saves the draft once per Control+Enter or Meta+Enter press from any editor control", () => {
    const onSave = vi.fn<(note: string) => void>();
    const onCancel = vi.fn();
    renderEditor(selectionFixture({ note: "" }), onSave, { onCancel });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Cancel",
    )!;
    act(() => setTextareaValue(textarea, "Line one\nLine two"));

    const enter = (init: KeyboardEventInit) =>
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
    act(() => {
      textarea.dispatchEvent(enter({}));
    });
    expect(onSave).not.toHaveBeenCalled();

    const shortcut = enter({ ctrlKey: true });
    act(() => {
      textarea.dispatchEvent(shortcut);
      textarea.dispatchEvent(enter({ ctrlKey: true, repeat: true }));
      cancel.dispatchEvent(enter({ metaKey: true }));
    });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave.mock.calls).toEqual([["Line one\nLine two"], ["Line one\nLine two"]]);
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

  test("opens the saved note with focus at the end of the draft", () => {
    const selection = selectionFixture({ note: "Compare these values" });
    renderEditor(selection, () => {});

    const editor = document.querySelector<HTMLDialogElement>("[data-marimo-lens-note-editor]")!;
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(editor.getAttribute("aria-label")).toBe("Edit note for S1, Cell cell-1");
    expect(textarea.value).toBe(selection.note);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(selection.note.length);
  });

  test("renders as a nonmodal dialog", () => {
    renderEditor(selectionFixture(), () => {});
    const editor = document.querySelector<HTMLDialogElement>("[data-marimo-lens-note-editor]")!;

    expect(editor.open).toBe(true);

    act(() => root?.unmount());
    root = null;
    expect(document.querySelector("[data-marimo-lens-note-editor]")).toBeNull();
  });

  test("keeps Tab within the note editor", () => {
    renderEditor(selectionFixture(), () => {});
    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")!;
    const done = Array.from(editor.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Done",
    )!;

    act(() => {
      done.focus();
      done.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(textarea);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(done);
  });

  test("identifies a region selection in the metadata row", () => {
    renderEditor(
      selectionFixture({
        anchor: { kind: "rect", x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      }),
      () => {},
    );

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    expect(editor.querySelector("svg title")?.textContent).toBe("Region selection");
  });

  test("routes cancel and removal through the note workflow", () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    renderEditor(selectionFixture(), () => {}, { onCancel, onDelete });

    const editor = document.querySelector<HTMLElement>("[data-marimo-lens-note-editor]")!;
    const cancel = Array.from(editor.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Cancel",
    );
    const remove = editor.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove selection S1"]',
    );
    act(() => {
      cancel?.click();
      remove?.click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  test("keeps the draft open and focused after a backdrop press", () => {
    renderEditor(selectionFixture({ note: "Keep this draft" }), () => {});
    const editor = document.querySelector<HTMLDialogElement>("[data-marimo-lens-note-editor]")!;
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    act(() => {
      outside.focus();
      editor.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    });

    expect(textarea.value).toBe("Keep this draft");
    expect(document.activeElement).toBe(textarea);
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
      selector={null}
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
