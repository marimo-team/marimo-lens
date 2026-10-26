import type { Selection } from "@marimo-lens/protocol";

import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";

import { selectionFixture } from "../../support/fixtures";
import { render } from "../../support/render";

let notebookDom: NotebookDomAdapter | null = null;

afterEach(() => {
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

  test("names the target and its producing cell in the header", () => {
    renderEditor(
      selectionFixture({
        description: { label: "Vega visualization", detail: "revenue_chart" },
      }),
      vi.fn(),
    );

    expect(document.querySelector("header")?.textContent).toContain(
      "Vega visualization · revenue_chart",
    );
  });

  // Browsers move focus to the page when the focused control becomes disabled.
  test("keeps the note field focusable and its actions inert while a save is pending", () => {
    const onSave = vi.fn<(note: string) => void>();
    const selection = selectionFixture({ note: "" });
    const { rerender } = renderEditor(selection, onSave);
    const textarea = document.querySelector("textarea")!;
    expect(document.activeElement).toBe(textarea);

    rerender(withNotebookDom(editor(selection, onSave, { saving: true, mutationPending: true })));
    const done = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Saving…",
    )!;
    act(() => done.click());

    expect(textarea.disabled).toBe(false);
    expect(textarea.readOnly).toBe(true);
    expect(done.disabled).toBe(false);
    expect(done.getAttribute("aria-disabled")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
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
    const { rerender } = renderEditor(selection, onSave);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => setTextareaValue(textarea, "Compare this peak with the threshold"));

    rerender(
      withNotebookDom(
        editor(
          { ...selection, snapshot: { status: "failed", capturedAt: "2026-07-14T12:00:00Z" } },
          onSave,
        ),
      ),
    );

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
  document.body.append(output);
  notebookDom = new NotebookDomAdapter(document);
  return render(withNotebookDom(editor(selection, onSave, overrides)));
}

function editor(
  selection: Selection,
  onSave: (note: string) => void,
  overrides: Partial<React.ComponentProps<typeof SelectionNoteEditor>> = {},
) {
  return (
    <SelectionNoteEditor
      selection={selection}
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
