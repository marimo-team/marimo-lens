import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { SelectionResolvedEvent } from "@/contracts";
import type { UiAction } from "@/state";

import { MarimoLensContent } from "@/components/marimo-lens-content";

import { selectionFixture } from "../test-fixtures";

const mocks = vi.hoisted(() => ({
  useDocumentInteractions: vi.fn(),
  useLensModel: vi.fn(),
  useSelectionActions: vi.fn(),
}));

vi.mock("@/document-interactions", () => ({
  useDocumentInteractions: mocks.useDocumentInteractions,
}));
vi.mock("@/model", () => ({ useLensModel: mocks.useLensModel }));
vi.mock("@/selection-actions", () => ({ useSelectionActions: mocks.useSelectionActions }));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function actionsFor(dispatch: (action: UiAction) => void) {
  return {
    beginSelection: vi.fn(),
    activateSelection: (selectionId: string) =>
      dispatch({ type: "selectionActivated", selectionId }),
    openNote: (selectionId: string) => dispatch({ type: "editNote", selectionId }),
    saveNote: vi.fn(),
    deleteSelection: vi.fn(),
    clearSelections: vi.fn(),
    refreshSnapshot: vi.fn(),
    repositionSelection: vi.fn(),
    invalidateSnapshotCapture: vi.fn(),
  };
}

describe("marimo Lens content", () => {
  test("activates a detached selection and announces its unavailable output", () => {
    const selection = selectionFixture();
    const activateSelection = vi.fn();
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [selection],
      },
      lensCss: "",
      protocol: {
        getSnapshot: vi.fn(),
        onSelectionResolved: vi.fn(() => vi.fn()),
      },
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => ({
        beginSelection: vi.fn(),
        activateSelection: (selectionId: string) => {
          activateSelection(selectionId);
          dispatch({ type: "selectionActivated", selectionId });
        },
        openNote: vi.fn(),
        saveNote: vi.fn(),
        deleteSelection: vi.fn(),
        clearSelections: vi.fn(),
        refreshSnapshot: vi.fn(),
        repositionSelection: vi.fn(),
        invalidateSnapshotCapture: vi.fn(),
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const listTrigger = document.querySelector<HTMLButtonElement>("[data-ml-list]");
    act(() => listTrigger?.click());
    const row = document.querySelector<HTMLButtonElement>('[aria-label^="Activate selection S1"]');
    act(() => row?.click());

    expect(activateSelection).toHaveBeenCalledWith(selection.id);
    expect(row?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Output unavailable.",
    );
  });

  test("presents and announces a resolution only after canonical state removes it", () => {
    vi.useFakeTimers();
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const onSelectionResolved = vi.fn((next: (event: SelectionResolvedEvent) => void) => {
      listener = next;
      return vi.fn();
    });
    const selection = selectionFixture();
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
      },
      lensCss: "",
      protocol: { getSnapshot: vi.fn(), onSelectionResolved },
    };
    mocks.useLensModel.mockImplementation(() => model);
    const invalidateSnapshotCapture = vi.fn();
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => ({
        ...actionsFor(dispatch),
        invalidateSnapshotCapture,
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const event = resolvedEvent({ summary: "Updated the chart." });
    act(() => listener?.(event));

    expect(invalidateSnapshotCapture).toHaveBeenCalledWith(selection.id);
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe("");

    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")?.textContent).toContain(
      "S1resolvedUpdated the chart.",
    );
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "S1 resolved. Updated the chart.",
    );

    act(() =>
      listener?.(resolvedEvent({ revision: 3, selectionId: "selection-old", label: "S9" })),
    );
    expect(
      document.querySelector<HTMLElement>("[data-marimo-lens-resolution-receipt]")?.dataset
        .selectionId,
    ).toBe("selection-1");

    act(() => {
      vi.advanceTimersByTime(5_999);
    });
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
  });

  test("keeps the receipt inside an open selection sheet", () => {
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: first.id as string | null,
        selections: [first, second],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    act(() => document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click());

    act(() => listener?.(resolvedEvent()));
    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S3",
        currentSelectionId: second.id,
        selections: [second],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    const sheet = document.querySelector("[data-marimo-lens-selection-list]");
    const receipt = document.querySelector("[data-marimo-lens-resolution-receipt]");
    expect(sheet).not.toBeNull();
    expect(receipt).not.toBeNull();
    expect(sheet?.contains(receipt)).toBe(true);
  });

  test("moves focus from a resolved selection to the current fallback", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: first.id as string | null,
        selections: [first, second],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    act(() => document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click());
    const firstRow = document.querySelector<HTMLButtonElement>(
      `[data-marimo-lens-selection-focus="${first.id}"]`,
    );
    act(() => firstRow?.focus());

    act(() => listener?.(resolvedEvent()));
    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S3",
        currentSelectionId: second.id,
        selections: [second],
      },
    };
    act(() => root?.render(<MarimoLensContent />));
    act(() => {
      for (const callback of frames.splice(0)) callback(0);
    });

    expect(document.activeElement).toBe(
      document.querySelector(`[data-marimo-lens-selection-focus="${second.id}"]`),
    );
  });

  test("moves focus from a resolved marker to the collapsed Lens tab", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const output = document.createElement("div");
    output.id = `output-${selection.outputCellId}`;
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    document.body.appendChild(output);
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Collapse Lens"]')?.click());
    act(() => {
      for (const callback of frames.splice(0)) callback(0);
    });
    const marker = document.querySelector<HTMLButtonElement>(
      `[data-marimo-lens-selection-id="${selection.id}"]`,
    );
    act(() => marker?.focus());

    act(() => listener?.(resolvedEvent()));
    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));
    act(() => {
      for (const callback of frames.splice(0)) callback(0);
    });

    expect(document.activeElement).toBe(document.querySelector("[data-ml-dock-tab]"));
  });

  test("preserves focus outside the resolved selection", () => {
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const unrelated = document.createElement("button");
    document.body.appendChild(unrelated);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    unrelated.focus();

    act(() => listener?.(resolvedEvent()));
    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.activeElement).toBe(unrelated);
  });

  test("unlocks note editing when its selection disappears", () => {
    const selection = selectionFixture();
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    act(() => document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Edit note for S1"]')?.click(),
    );
    expect(document.querySelector("[data-marimo-lens-note-editor]")).not.toBeNull();

    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-note-editor]")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-ml-select]")?.disabled).toBe(false);
  });

  test("keeps the selection sheet closed after its final row disappears", () => {
    const selection = selectionFixture();
    const protocol = {
      getSnapshot: vi.fn(),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
      },
      lensCss: "",
      protocol,
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    act(() => document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click());
    expect(document.querySelector("[data-marimo-lens-selection-list]")).not.toBeNull();

    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));
    model = {
      ...model,
      state: {
        revision: 5,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-selection-list]")).toBeNull();
  });
});

function resolvedEvent(
  overrides: Partial<SelectionResolvedEvent["payload"]> & { revision?: number } = {},
): SelectionResolvedEvent {
  const { revision = 4, ...payload } = overrides;
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "selection.resolved",
    revision,
    payload: {
      selectionId: "selection-1",
      label: "S1",
      ...payload,
    },
  };
}
