import { act, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { UiState } from "@/selection/state";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { useDocumentInteractions, type BeginSelection } from "@/selection/document-interactions";
import { uiReducer } from "@/selection/state";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementsFromPoint");
  delete document.documentElement.dataset.marimoLensArmed;
  vi.restoreAllMocks();
});

describe("document selection interactions", () => {
  test("creates a centered point from the armed Select button", () => {
    visibleOutput();
    const beginSelection = vi.fn<BeginSelection>();
    mount(beginSelection);
    const select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;

    act(() => {
      select.focus();
      select.click();
    });
    act(() => {
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(beginSelection).toHaveBeenCalledWith(
      "cell-1",
      expect.any(HTMLElement),
      { kind: "point", x: 0.5, y: 0.5 },
      expect.any(Element),
    );
  });

  test("tracks a point gesture inside a same-origin iframe", () => {
    const output = visibleOutput();
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100);
    output.appendChild(frame);
    const target = frame.contentDocument!.createElement("button");
    frame.contentDocument!.body.appendChild(target);
    const beginSelection = vi.fn<BeginSelection>();
    mount(beginSelection);
    arm();

    void act(() => target.dispatchEvent(pointer("pointerdown", 20, 30, 7)));
    void act(() => target.dispatchEvent(pointer("pointerup", 20, 30, 7)));

    expect(beginSelection).toHaveBeenCalledWith(
      "cell-1",
      output,
      { kind: "point", x: 0.3, y: 0.4 },
      frame,
    );
  });

  test("uses an inaccessible iframe as the snapshot detail boundary", () => {
    const output = visibleOutput();
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100);
    Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
    output.appendChild(frame);
    const beginSelection = vi.fn<BeginSelection>();
    mount(beginSelection);
    arm();

    void act(() => output.dispatchEvent(pointer("pointerdown", 150, 80, 9)));
    void act(() => output.dispatchEvent(pointer("pointerup", 150, 80, 9)));

    expect(beginSelection).toHaveBeenCalledWith(
      "cell-1",
      output,
      { kind: "point", x: 0.375, y: 0.4 },
      frame,
    );
  });

  test("owns touch gestures while armed and restores document styles", () => {
    const output = visibleOutput();
    output.style.setProperty("touch-action", "pan-y");
    mount(vi.fn<BeginSelection>());

    arm();
    expect(output.style.getPropertyValue("touch-action")).toBe("none");
    expect(output.style.getPropertyPriority("touch-action")).toBe("important");

    disarm();
    expect(output.style.getPropertyValue("touch-action")).toBe("pan-y");
    expect(output.style.getPropertyPriority("touch-action")).toBe("");
  });

  test("keeps one interaction surface throughout a pointer gesture", () => {
    const output = visibleOutput();
    const addEventListener = vi.spyOn(document, "addEventListener");
    const pointerMoveRegistrations = () =>
      addEventListener.mock.calls.filter(([type]) => type === "pointermove").length;
    mount(vi.fn<BeginSelection>());
    arm();
    const armedRegistrations = pointerMoveRegistrations();

    void act(() => output.dispatchEvent(pointer("pointerdown", 40, 50, 11)));
    void act(() => output.dispatchEvent(pointer("pointermove", 80, 90, 11)));
    void act(() => output.dispatchEvent(pointer("pointermove", 120, 110, 11)));

    expect(pointerMoveRegistrations()).toBe(armedRegistrations);
  });

  test("keeps one iframe interaction surface throughout a pointer gesture", () => {
    const output = visibleOutput();
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100);
    output.appendChild(frame);
    const target = frame.contentDocument!.createElement("button");
    frame.contentDocument!.body.appendChild(target);
    const addEventListener = vi.spyOn(frame.contentDocument!, "addEventListener");
    const pointerMoveRegistrations = () =>
      addEventListener.mock.calls.filter(([type]) => type === "pointermove").length;
    mount(vi.fn<BeginSelection>());
    arm();
    const armedRegistrations = pointerMoveRegistrations();

    void act(() => target.dispatchEvent(pointer("pointerdown", 20, 30, 12)));
    void act(() => target.dispatchEvent(pointer("pointermove", 40, 40, 12)));
    void act(() => target.dispatchEvent(pointer("pointermove", 60, 50, 12)));

    expect(pointerMoveRegistrations()).toBe(armedRegistrations);
  });
});

function mount(beginSelection: BeginSelection): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness beginSelection={beginSelection} />));
}

function Harness({ beginSelection }: { beginSelection: BeginSelection }) {
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_STATE);
  const uiRef = useRef(ui);
  const canceledPointerIds = useRef(new Set<number>());
  const cancelAdjustment = useCallback(() => false, []);
  const dom = useMemo(() => new NotebookDomAdapter(document), []);
  useLayoutEffect(() => {
    uiRef.current = ui;
  }, [ui]);
  useDocumentInteractions({
    workflow: ui.workflow,
    uiRef,
    dispatch,
    dom,
    beginSelection,
    canceledPointerIds,
    cancelAdjustment,
  });
  return (
    <button
      type="button"
      data-marimo-lens-ui
      data-ml-select
      onClick={() => dispatch(ui.workflow.mode === "armed" ? { type: "disarm" } : { type: "arm" })}
    >
      Select
    </button>
  );
}

function arm(): void {
  act(() => document.querySelector<HTMLButtonElement>("[data-ml-select]")?.click());
}

function disarm(): void {
  act(() => document.querySelector<HTMLButtonElement>("[data-ml-select]")?.click());
}

function visibleOutput(): HTMLElement {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
  Object.assign(output, {
    scrollIntoView: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    releasePointerCapture: vi.fn(),
  });
  document.body.appendChild(output);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [output],
  });
  return output;
}

function pointer(type: string, clientX: number, clientY: number, pointerId: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event as PointerEvent;
}

const INITIAL_STATE: UiState = {
  workflow: { mode: "idle" },
  pendingSelections: [],
  optimisticCurrentSelectionId: null,
  busySelectionIds: [],
  clearPending: false,
  historyClearPending: false,
  listOpen: false,
  sheetTab: "open",
  focusedHistoryRevision: null,
  announcement: "",
};
