import type {
  AddressedSelection,
  CellAttentionEvent,
  OutputCaptureCommand,
  Selection,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { UiAction } from "@/selection/state";

import { MarimoLensContent as Content } from "@/app/marimo-lens-content";

import { selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";

const mocks = vi.hoisted(() => ({
  useDocumentInteractions: vi.fn(),
  useLensModel: vi.fn(),
  useSelectionActions: vi.fn(),
}));

vi.mock("@/selection/document-interactions", () => ({
  useDocumentInteractions: mocks.useDocumentInteractions,
}));
vi.mock("@marimo-lens/image-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@marimo-lens/image-capture")>()),
  captureOutputSnapshot: vi.fn(),
}));
vi.mock("@/anywidget/model", () => ({ useLensModel: mocks.useLensModel }));
vi.mock("@/selection/selection-actions", () => ({
  useSelectionActions: mocks.useSelectionActions,
}));
vi.mock("@/notebook/viewport", () => ({ useViewportRevision: () => 0 }));

let root: Root | null = null;

function MarimoLensContent() {
  return (
    <NotebookDomTestProvider>
      <Content />
    </NotebookDomTestProvider>
  );
}

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
    reopenSelection: vi.fn(),
    clearHistory: vi.fn(),
    repositionSelection: vi.fn(),
    invalidateSnapshotCapture: vi.fn(),
    settleUnavailableSnapshot: vi.fn(),
  };
}

function protocolDefaults() {
  return {
    onCellAttention: vi.fn(() => vi.fn()),
  };
}

describe("marimo-lens content", () => {
  test("applies the native anywidget stylesheet to the body portal", () => {
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 0,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [] as AddressedSelection[],
      },
      css: ".marimo_lens { color: rgb(8, 128, 234); }",
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<MarimoLensContent />));

    const portal = document.querySelector<HTMLElement>("[data-marimo-lens-root]");
    expect(portal?.parentElement).toBe(document.body);
    expect(document.getElementById("marimo-lens-global-styles")?.textContent).toBe(
      ".marimo_lens { color: rgb(8, 128, 234); }",
    );

    act(() => root?.unmount());
    root = null;
    expect(document.getElementById("marimo-lens-global-styles")).toBeNull();
  });

  test("captures the exact canonical output for a reverse protocol request", async () => {
    const frames = controlledAnimationFrames();
    let captureHandler:
      | ((command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>)
      | undefined;
    const releaseCaptureHandler = vi.fn();
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(
        (handler: (command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>) => {
          captureHandler = handler;
          return releaseCaptureHandler;
        },
      ),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [] as AddressedSelection[],
      },
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    vi.mocked(captureOutputSnapshot).mockResolvedValue({
      metadata: {
        status: "available",
        id: "image:capture-1",
        mediaType: "image/png",
        width: 400,
        height: 240,
        sha256: "a".repeat(64),
        capturedAt: "2026-07-18T10:01:00Z",
      },
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    const selections: OutputCaptureCommand["payload"]["selections"] = [
      {
        selectionId: "selection-1",
        label: "S1",
        anchor: { kind: "point", x: 0.25, y: 0.5 },
      },
      {
        selectionId: "selection-2",
        label: "S2",
        anchor: { kind: "rect", x: 0.4, y: 0.2, width: 0.3, height: 0.4 },
      },
    ];
    const command = outputCaptureCommand(selections);
    const controller = new AbortController();
    const capture = captureHandler!(command, controller.signal);

    expect(captureOutputSnapshot).not.toHaveBeenCalled();
    document.body.appendChild(output);
    frames.flushNext();
    await expect(capture).resolves.toEqual({
      image: expect.objectContaining({ id: "image:capture-1" }),
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(captureOutputSnapshot).toHaveBeenCalledWith({
      imageId: "image:capture-1",
      output,
      selections,
      signal: controller.signal,
    });

    act(() => root?.unmount());
    root = null;
    expect(releaseCaptureHandler).toHaveBeenCalledOnce();
  });

  test("reports missing and failed output capture through stable protocol errors", async () => {
    const frames = controlledAnimationFrames();
    let captureHandler:
      | ((command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>)
      | undefined;
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(
        (handler: (command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>) => {
          captureHandler = handler;
          return vi.fn();
        },
      ),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [] as AddressedSelection[],
      },
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const missing = captureHandler!(outputCaptureCommand(), new AbortController().signal);
    frames.flushNext();
    await expect(missing).rejects.toMatchObject({ code: "output_unavailable" });

    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(output);
    vi.mocked(captureOutputSnapshot).mockRejectedValue(
      new Error("Canvas rendering is unavailable"),
    );

    const failed = captureHandler!(outputCaptureCommand(), new AbortController().signal);
    frames.flushNext();
    await expect(failed).rejects.toMatchObject({
      message: "Canvas rendering is unavailable",
    });
  });

  test("cancels the next-paint barrier when the active view unmounts", async () => {
    const frames = controlledAnimationFrames();
    const controller = new AbortController();
    let captureHandler:
      | ((command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>)
      | undefined;
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(
        (handler: (command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>) => {
          captureHandler = handler;
          return () => controller.abort(new DOMException("Lens view released", "AbortError"));
        },
      ),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [] as AddressedSelection[],
      },
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    const capture = captureHandler!(outputCaptureCommand(), controller.signal);
    const rejection = expect(capture).rejects.toMatchObject({ name: "AbortError" });

    act(() => root?.unmount());
    root = null;

    expect(controller.signal.aborted).toBe(true);
    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(captureOutputSnapshot).not.toHaveBeenCalled();
    await rejection;
  });

  test("rejects a capture when the canonical output root changes", async () => {
    const frames = controlledAnimationFrames();
    let captureHandler:
      | ((command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>)
      | undefined;
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(
        (handler: (command: OutputCaptureCommand, signal: AbortSignal) => Promise<unknown>) => {
          captureHandler = handler;
          return vi.fn();
        },
      ),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [] as AddressedSelection[],
      },
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(output);
    const pending = deferred<Awaited<ReturnType<typeof captureOutputSnapshot>>>();
    vi.mocked(captureOutputSnapshot).mockImplementationOnce(() => pending.promise);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const capture = captureHandler!(outputCaptureCommand(), new AbortController().signal);
    const rejection = expect(capture).rejects.toMatchObject({
      code: "capture_failed",
    });
    await advanceToCapture(frames, 1);
    const replacement = document.createElement("div");
    replacement.id = "output-cell-1";
    replacement.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    await act(async () => {
      output.replaceWith(replacement);
      await Promise.resolve();
    });
    await act(async () => {
      pending.resolve(availableCapture("image:capture-1"));
      await rejection;
    });
  });

  test("activates a detached selection and announces its unavailable output", async () => {
    const selection = selectionFixture();
    const activateSelection = vi.fn();
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [selection],
        history: [],
      },
      protocol: {
        ...protocolDefaults(),
        getSnapshot: vi.fn(),
        onOutputCapture: vi.fn(() => vi.fn()),
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
        reopenSelection: vi.fn(),
        clearHistory: vi.fn(),
        repositionSelection: vi.fn(),
        invalidateSnapshotCapture: vi.fn(),
        settleUnavailableSnapshot: vi.fn(),
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const listTrigger = document.querySelector<HTMLButtonElement>("[data-ml-list]");
    await act(async () => {
      listTrigger?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = document.querySelector<HTMLButtonElement>('[aria-label^="Activate selection S1"]');
    act(() => row?.click());

    expect(activateSelection).toHaveBeenCalledWith(selection.id);
    expect(row?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Output unavailable.",
    );
  });

  test("presents transient cell attention without changing dock state or focus", () => {
    vi.useFakeTimers();
    let listener: ((event: CellAttentionEvent) => void) | undefined;
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
      onSelectionResolved: vi.fn(() => vi.fn()),
      onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
      protocol,
    });
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => actionsFor(dispatch),
    );
    const cell = document.createElement("section");
    cell.id = "cell-BYtC";
    cell.getBoundingClientRect = () => new DOMRect(20, 20, 400, 300);
    cell.scrollIntoView = vi.fn();
    const outside = document.createElement("button");
    document.body.append(cell, outside);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    outside.focus();

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 1,
        type: "cell.reveal",
        revision: 7,
        payload: { cellId: "BYtC", message: "Updated the aggregation." },
      }),
    );

    expect(document.querySelector("[data-marimo-lens-dock]")?.getAttribute("data-expanded")).toBe(
      "true",
    );
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(outside);
    expect(document.querySelector("[data-marimo-lens-cell-attention-notice]")).toBeNull();
    const attention = document.querySelector("[data-marimo-lens-cell-attention]");
    expect(attention?.querySelector(".ml-cell-attention__status")?.textContent).toBe("Ready");
    expect(attention?.querySelector(".ml-cell-attention__cell")?.textContent).toBe("BYtC");
    expect(attention?.querySelector(".ml-cell-attention__message")?.textContent).toBe(
      "Updated the aggregation.",
    );
    const attentionStatus = () =>
      document.querySelector("[data-marimo-lens-cell-attention-status]")?.textContent;
    expect(attentionStatus()).toBe("Revealed cell BYtC. Updated the aggregation.");

    const reboundProtocol = {
      ...protocol,
      onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    };
    mocks.useLensModel.mockReturnValue({
      state: {
        revision: 8,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
      protocol: reboundProtocol,
    });
    act(() => root?.render(<MarimoLensContent />));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();

    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Select an output"]')?.click(),
    );
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Select mode active. Click a point or drag a region.",
    );

    void act(() => vi.advanceTimersByTime(2_380));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(attentionStatus()).toBe("");
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Select mode active. Click a point or drag a region.",
    );
    expect(cell.className).toBe("");

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 1,
        type: "cell.reveal",
        revision: 7,
        payload: { cellId: "not-rendered", message: "Inspect the upstream change." },
      }),
    );
    const unavailable = document.querySelector<HTMLElement>(
      "[data-marimo-lens-cell-attention-notice]",
    );
    expect(unavailable?.textContent).toContain(
      "Not visiblenot-renderedInspect the upstream change.",
    );
    expect(attentionStatus()).toBe("Revealed cell not-rendered. Inspect the upstream change.");

    const offscreen = document.createElement("section");
    offscreen.id = "cell-offscreen";
    offscreen.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 20, 400, 300);
    offscreen.scrollIntoView = vi.fn();
    document.body.appendChild(offscreen);
    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 1,
        type: "cell.reveal",
        revision: 7,
        payload: { cellId: "offscreen", message: "Inspect this result." },
      }),
    );
    expect(offscreen.scrollIntoView).toHaveBeenCalledOnce();
    expect(
      document.querySelector("[data-marimo-lens-cell-attention-notice]")?.textContent,
    ).toContain("Not visibleoffscreenInspect this result.");

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 1,
        type: "cell.activity",
        revision: 7,
        payload: { cellId: "BYtC", message: "Updating the aggregation." },
      }),
    );
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    const activity = document.querySelector("[data-marimo-lens-cell-attention]");
    expect(activity?.querySelector(".ml-cell-attention__message")?.textContent).toBe(
      "Updating the aggregation.",
    );
    expect(activity?.querySelector("[data-marimo-lens-working-indicator]")).not.toBeNull();
    expect(attentionStatus()).toBe("Working in cell BYtC. Updating the aggregation.");
  });

  test("settles marked capture work when its output disappears", async () => {
    const selection = selectionFixture({ snapshot: { status: "pending" } });
    const output = document.createElement("div");
    output.id = `output-${selection.outputCellId}`;
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(output);
    const settleUnavailableSnapshot = vi.fn();
    let model = {
      state: {
        revision: 1,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      },
      protocol: {
        ...protocolDefaults(),
        getSnapshot: vi.fn(),
        onOutputCapture: vi.fn(() => vi.fn()),
        onSelectionResolved: vi.fn(() => vi.fn()),
      },
    };
    mocks.useLensModel.mockImplementation(() => model);
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => ({
        ...actionsFor(dispatch),
        settleUnavailableSnapshot,
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    expect(settleUnavailableSnapshot).not.toHaveBeenCalled();

    model = {
      ...model,
      state: { ...model.state, selections: [{ ...selection }] },
    };
    act(() => {
      output.remove();
      root?.render(<MarimoLensContent />);
    });

    expect(settleUnavailableSnapshot).toHaveBeenCalledWith(selection.id);

    settleUnavailableSnapshot.mockClear();
    model = {
      ...model,
      state: {
        ...model.state,
        selections: [
          {
            ...selection,
            snapshot: {
              status: "failed",
              capturedAt: "2026-07-14T12:00:00Z",
              error: "Snapshot unavailable.",
            },
          },
        ],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(settleUnavailableSnapshot).not.toHaveBeenCalled();
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
        history: [] as AddressedSelection[],
      },
      protocol: {
        ...protocolDefaults(),
        getSnapshot: vi.fn(),
        onOutputCapture: vi.fn(() => vi.fn()),
        onSelectionResolved,
      },
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
        history: [addressedReceipt(selection, event)],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")?.textContent).toContain(
      "S1AddressedUpdated the chart.",
    );
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "S1 addressed. Updated the chart.",
    );
    expect(document.querySelector("[data-marimo-lens-selection-list]")).toBeNull();

    const receipt = document.querySelector<HTMLButtonElement>(
      "[data-marimo-lens-resolution-receipt]",
    );
    act(() => receipt?.focus());
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).not.toBeNull();

    act(() => receipt?.click());
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "History",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reopen S1");

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

  test("reconciles one resolution receipt for an atomic batch", () => {
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const onSelectionResolved = vi.fn((next: (event: SelectionResolvedEvent) => void) => {
      listener = next;
      return vi.fn();
    });
    let model = {
      state: {
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: second.id as string | null,
        selections: [first, second],
        history: [] as AddressedSelection[],
      },
      protocol: {
        ...protocolDefaults(),
        getSnapshot: vi.fn(),
        onOutputCapture: vi.fn(() => vi.fn()),
        onSelectionResolved,
      },
    };
    mocks.useLensModel.mockImplementation(() => model);
    const invalidateSnapshotCapture = vi.fn();
    mocks.useSelectionActions.mockImplementation(
      ({ dispatch }: { dispatch: (action: UiAction) => void }) => ({
        ...actionsFor(dispatch),
        invalidateSnapshotCapture,
      }),
    );
    const event = resolvedEvent({
      selections: [
        {
          selectionId: first.id,
          label: first.label,
          resolutionRevision: 4,
        },
        {
          selectionId: second.id,
          label: second.label,
          resolutionRevision: 4,
        },
      ],
      summary: "Updated and verified both requests.",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    act(() => listener?.(event));

    expect(invalidateSnapshotCapture.mock.calls.map(([selectionId]) => selectionId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();

    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S3",
        currentSelectionId: null,
        selections: [],
        history: [addressedReceipt(first, event), addressedReceipt(second, event)],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")?.textContent).toContain(
      "2 selectionsAddressedUpdated and verified both requests.",
    );
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "2 selections addressed. Updated and verified both requests.",
    );
  });

  test("keeps the receipt inside an open selection sheet", async () => {
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
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
        history: [] as AddressedSelection[],
      },
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => listener?.(resolvedEvent()));
    model = {
      ...model,
      state: {
        revision: 4,
        nextLabel: "S3",
        currentSelectionId: second.id,
        selections: [second],
        history: [addressedReceipt(first, resolvedEvent())],
      },
    };
    await act(async () => {
      root?.render(<MarimoLensContent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const sheet = document.querySelector("[data-marimo-lens-selection-list]");
    const receipt = document.querySelector("[data-marimo-lens-resolution-receipt]");
    expect(sheet).not.toBeNull();
    expect(receipt).not.toBeNull();
    expect(sheet?.contains(receipt)).toBe(true);
  });

  test("moves focus from a resolved selection to the current fallback", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
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
        history: [] as AddressedSelection[],
      },
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-ml-list]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
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
        history: [addressedReceipt(first, resolvedEvent())],
      },
    };
    await act(async () => {
      root?.render(<MarimoLensContent />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      for (const callback of frames.splice(0)) callback(0);
      await Promise.resolve();
      await Promise.resolve();
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
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
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
        history: [] as AddressedSelection[],
      },
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
        history: [addressedReceipt(selection, resolvedEvent())],
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
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
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
        history: [] as AddressedSelection[],
      },
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
        history: [addressedReceipt(selection, resolvedEvent())],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.activeElement).toBe(unrelated);
  });

  test("unlocks note editing when its selection disappears", () => {
    const selection = selectionFixture();
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
        history: [],
      },
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
        history: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-note-editor]")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-ml-select]")?.disabled).toBe(false);
  });

  test("keeps the selection sheet closed after its final row disappears", () => {
    const selection = selectionFixture();
    const protocol = {
      ...protocolDefaults(),
      getSnapshot: vi.fn(),
      onOutputCapture: vi.fn(() => vi.fn()),
      onSelectionResolved: vi.fn(() => vi.fn()),
    };
    let model = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id as string | null,
        selections: [selection],
        history: [],
      },
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
        history: [],
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
        history: [],
      },
    };
    act(() => root?.render(<MarimoLensContent />));

    expect(document.querySelector("[data-marimo-lens-selection-list]")).toBeNull();
  });
});

function resolvedEvent(
  overrides: {
    revision?: number;
    selectionId?: string;
    label?: string;
    summary?: string;
    selections?: SelectionResolvedEvent["payload"]["selections"];
  } = {},
): SelectionResolvedEvent {
  const {
    revision = 4,
    selectionId = "selection-1",
    label = "S1",
    summary,
    selections = [{ selectionId, label, resolutionRevision: revision }],
  } = overrides;
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "selection.resolved",
    revision,
    payload: {
      selections,
      ...(summary ? { summary } : {}),
    },
  };
}

function addressedReceipt(selection: Selection, event: SelectionResolvedEvent): AddressedSelection {
  const resolved = event.payload.selections.find(({ selectionId }) => selectionId === selection.id);
  return {
    selectionId: selection.id,
    label: selection.label,
    note: selection.note,
    outputCellId: selection.outputCellId,
    createdAt: selection.createdAt,
    addressedAt: "2026-07-23T08:00:00Z",
    anchor: selection.anchor,
    ...(selection.domHint ? { domHint: selection.domHint } : {}),
    ...(event.payload.summary ? { summary: event.payload.summary } : {}),
    resolutionRevision: resolved?.resolutionRevision ?? event.revision,
  };
}

function outputCaptureCommand(
  selections: OutputCaptureCommand["payload"]["selections"] = [],
): OutputCaptureCommand {
  return {
    protocol: "marimo-lens.command",
    version: 1,
    requestId: "capture-1",
    type: "output.capture",
    payload: { outputCellId: "cell-1", selections },
  };
}

function controlledAnimationFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }),
  );
  const cancel = vi.fn((id: number) => callbacks.delete(id));
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    cancel,
    flushNext() {
      const entry = callbacks.entries().next().value;
      if (!entry) throw new Error("No animation frame is pending");
      const [id, callback] = entry;
      callbacks.delete(id);
      callback(0);
    },
  };
}

function availableCapture(imageId: string): Awaited<ReturnType<typeof captureOutputSnapshot>> {
  return {
    metadata: {
      status: "available",
      id: imageId,
      mediaType: "image/png",
      width: 400,
      height: 240,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-18T10:01:00Z",
    },
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function advanceToCapture(
  frames: ReturnType<typeof controlledAnimationFrames>,
  callCount: number,
): Promise<void> {
  for (
    let index = 0;
    index < 10 && vi.mocked(captureOutputSnapshot).mock.calls.length < callCount;
    index += 1
  ) {
    frames.flushNext();
    await Promise.resolve();
  }
  expect(captureOutputSnapshot).toHaveBeenCalledTimes(callCount);
}
