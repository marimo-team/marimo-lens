import type { OutputCaptureHandler } from "@marimo-lens/image-capture";
import type {
  AddressedSelection,
  CellAttentionEvent,
  LensState,
  OutputCaptureCommand,
  Selection,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensWidgetModel } from "@/anywidget/client";
import type { LensModel } from "@/anywidget/model";
import type { UiAction } from "@/selection/state";

import { LensProtocolClient } from "@/anywidget/client";
import {
  MarimoLensContent as Content,
  type MarimoLensContentDependencies,
} from "@/app/marimo-lens-content";

import { selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";

let root: Root | null = null;
let currentModel: LensModel;
let currentModelFor = () => currentModel;

type ActionFactory = (dispatch: (action: UiAction) => void) => ReturnType<typeof actionsFor>;

let currentActionsFor: ActionFactory = actionsFor;
const captureOutput = vi.fn<typeof captureOutputSnapshot>();
const dependencies: MarimoLensContentDependencies = {
  captureOutputSnapshot: captureOutput,
  useLensModel: () => currentModelFor(),
  useSelectionActions: (options) => currentActionsFor(options.dispatch),
};

function MarimoLensContent() {
  return (
    <NotebookDomTestProvider>
      <Content dependencies={dependencies} />
    </NotebookDomTestProvider>
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  captureOutput.mockReset();
  currentActionsFor = actionsFor;
  currentModelFor = () => currentModel;
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

describe("marimo-lens content", () => {
  test("applies the native anywidget stylesheet to the body portal", () => {
    const protocol = protocolClient();
    currentModel = {
      state: lensState({
        revision: 0,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
      css: ".marimo_lens { color: rgb(8, 128, 234); }",
      selector: null,
      protocol,
    };
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
    let captureHandler: OutputCaptureHandler | undefined;
    const releaseCaptureHandler = vi.fn();
    const protocol = protocolClient({
      onOutputCapture: vi.fn((handler: OutputCaptureHandler) => {
        captureHandler = handler;
        return releaseCaptureHandler;
      }),
    });
    currentModel = {
      state: lensState({
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    captureOutput.mockResolvedValue({
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
    const command = outputCaptureCommand();
    const controller = new AbortController();
    const capture = requireCaptureHandler(captureHandler)(command, controller.signal);

    expect(captureOutput).not.toHaveBeenCalled();
    document.body.appendChild(output);
    frames.flushNext();
    await expect(capture).resolves.toEqual({
      image: expect.objectContaining({ id: "image:capture-1" }),
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(captureOutput).toHaveBeenCalledWith({
      imageId: "image:capture-1",
      output,
      signal: controller.signal,
    });

    act(() => root?.unmount());
    root = null;
    expect(releaseCaptureHandler).toHaveBeenCalledOnce();
  });

  test("reports missing and failed output capture through stable protocol errors", async () => {
    const frames = controlledAnimationFrames();
    let captureHandler: OutputCaptureHandler | undefined;
    const protocol = protocolClient({
      onOutputCapture: vi.fn((handler: OutputCaptureHandler) => {
        captureHandler = handler;
        return vi.fn();
      }),
    });
    currentModel = {
      state: lensState({
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const missing = requireCaptureHandler(captureHandler)(
      outputCaptureCommand(),
      new AbortController().signal,
    );
    frames.flushNext();
    await expect(missing).rejects.toMatchObject({ code: "output_unavailable" });

    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(output);
    captureOutput.mockRejectedValue(new Error("Canvas rendering is unavailable"));

    const failed = requireCaptureHandler(captureHandler)(
      outputCaptureCommand(),
      new AbortController().signal,
    );
    frames.flushNext();
    await expect(failed).rejects.toMatchObject({
      message: "Canvas rendering is unavailable",
    });
  });

  test("cancels the next-paint barrier when the active view unmounts", async () => {
    const frames = controlledAnimationFrames();
    const controller = new AbortController();
    let captureHandler: OutputCaptureHandler | undefined;
    const protocol = protocolClient({
      onOutputCapture: vi.fn((handler: OutputCaptureHandler) => {
        captureHandler = handler;
        return () => controller.abort(new DOMException("Lens view released", "AbortError"));
      }),
    });
    currentModel = {
      state: lensState({
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));
    const capture = requireCaptureHandler(captureHandler)(
      outputCaptureCommand(),
      controller.signal,
    );
    const rejection = expect(capture).rejects.toMatchObject({ name: "AbortError" });

    act(() => root?.unmount());
    root = null;

    expect(controller.signal.aborted).toBe(true);
    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(captureOutput).not.toHaveBeenCalled();
    await rejection;
  });

  test("rejects a capture when the canonical output root changes", async () => {
    const frames = controlledAnimationFrames();
    let captureHandler: OutputCaptureHandler | undefined;
    const protocol = protocolClient({
      onOutputCapture: vi.fn((handler: OutputCaptureHandler) => {
        captureHandler = handler;
        return vi.fn();
      }),
    });
    currentModel = {
      state: lensState({
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(output);
    const pending = deferred<Awaited<ReturnType<typeof captureOutputSnapshot>>>();
    captureOutput.mockImplementationOnce(() => pending.promise);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    const capture = requireCaptureHandler(captureHandler)(
      outputCaptureCommand(),
      new AbortController().signal,
    );
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
    currentModel = {
      state: {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: null,
        selections: [selection],
        history: [],
      },
      css: "",
      selector: null,
      protocol: protocolClient(),
    };
    currentActionsFor = (dispatch) => ({
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
    });

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
      "Target unavailable.",
    );
  });

  test("presents transient cell attention without changing dock state or focus", () => {
    vi.useFakeTimers();
    let listener: ((event: CellAttentionEvent) => void) | undefined;
    const resolutionListeners: Array<(event: SelectionResolvedEvent) => void> = [];
    const protocol = protocolClient({
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        resolutionListeners.push(next);
        return vi.fn();
      }),
      onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    currentModel = {
      state: {
        revision: 7,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
      css: "",
      selector: null,
      protocol,
    };
    const cell = document.createElement("section");
    cell.id = "cell-BYtC";
    cell.getBoundingClientRect = () => new DOMRect(20, 80, 400, 300);
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
        version: 3,
        type: "cell.reveal",
        revision: 7,
        payload: {
          cellId: "BYtC",
          durationMs: 4_000,
          message: "Updated the aggregation.",
        },
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

    const reboundProtocol = protocolClient({
      onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    currentModel = {
      state: {
        revision: 8,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
      css: "",
      selector: null,
      protocol: reboundProtocol,
    };
    act(() => root?.render(<MarimoLensContent />));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Select a target"]')?.click());
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Select mode active. Click a point or drag a region.",
    );

    void act(() => vi.advanceTimersByTime(4_180));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(attentionStatus()).toBe("");
    expect(document.querySelector("[data-marimo-lens-status]")?.textContent).toBe(
      "Select mode active. Click a point or drag a region.",
    );
    expect(cell.className).toBe("");

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.reveal",
        revision: 7,
        payload: {
          cellId: "not-rendered",
          durationMs: 4_000,
          message: "Inspect the upstream change.",
        },
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
        version: 3,
        type: "cell.reveal",
        revision: 7,
        payload: {
          cellId: "offscreen",
          durationMs: 4_000,
          message: "Inspect this result.",
        },
      }),
    );
    expect(offscreen.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-marimo-lens-cell-attention-notice]")).toBeNull();

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.start",
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

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.stop",
        revision: 7,
        payload: { cellId: "other" },
      }),
    );
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.stop",
        revision: 7,
        payload: { cellId: "BYtC" },
      }),
    );
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(attentionStatus()).toBe("");

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.start",
        revision: 7,
        payload: { cellId: "BYtC", message: "Finishing the aggregation." },
      }),
    );

    act(() => {
      for (const resolutionListener of resolutionListeners) {
        resolutionListener(resolvedEvent({ revision: 7 }));
      }
    });
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();

    act(() =>
      listener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.stop",
        revision: 7,
        payload: { cellId: "BYtC" },
      }),
    );
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
  });

  test("settles marked capture work when its output disappears", async () => {
    const selection = selectionFixture({ snapshot: { status: "pending" } });
    const output = document.createElement("div");
    output.id = `output-${selection.target.cellIds[0]}`;
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
      css: "",
      selector: null,
      protocol: protocolClient(),
    };
    currentModelFor = () => model;
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      settleUnavailableSnapshot,
    });
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

  test("leaves a pending target from another document for its owning view", () => {
    const selection = selectionFixture({
      target: {
        kind: "dom",
        cellIds: [],
        documentPath: "/another-view/",
        domSelector: "#summary",
      },
      snapshot: { status: "pending" },
    });
    const settleUnavailableSnapshot = vi.fn();
    currentModel = {
      state: lensState({
        revision: 1,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: "#summary",
      protocol: protocolClient(),
    };
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      settleUnavailableSnapshot,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<MarimoLensContent />));

    expect(settleUnavailableSnapshot).not.toHaveBeenCalled();
  });

  test("keeps an existing configured target available on first mount", () => {
    const target = document.createElement("section");
    target.id = "summary";
    target.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(target);
    const selection = selectionFixture({
      target: {
        kind: "dom",
        cellIds: [],
        documentPath: "/",
        domSelector: "#summary",
      },
      snapshot: { status: "pending" },
    });
    const settleUnavailableSnapshot = vi.fn();
    currentModel = {
      state: lensState({
        revision: 1,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: "#summary",
      protocol: protocolClient(),
    };
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      settleUnavailableSnapshot,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<MarimoLensContent />));

    expect(settleUnavailableSnapshot).not.toHaveBeenCalled();
    expect(
      document.querySelector(`[data-marimo-lens-selection-id="${selection.id}"]`),
    ).not.toBeNull();
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
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol: protocolClient({
        onSelectionResolved,
      }),
    };
    currentModelFor = () => model;
    const invalidateSnapshotCapture = vi.fn();
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      invalidateSnapshotCapture,
    });

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

  test("presents an addressed receipt after the active cell reveal finishes", () => {
    vi.useFakeTimers();
    let attentionListener: ((event: CellAttentionEvent) => void) | undefined;
    let resolutionListener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const event = resolvedEvent({ summary: "Updated the chart." });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol: protocolClient({
        onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
          attentionListener = next;
          return vi.fn();
        }),
        onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
          resolutionListener = next;
          return vi.fn();
        }),
      }),
    };
    currentModelFor = () => model;
    const cell = document.createElement("section");
    cell.id = `cell-${selection.target.cellIds[0]}`;
    cell.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    cell.scrollIntoView = vi.fn();
    document.body.appendChild(cell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.reveal",
        revision: 3,
        payload: {
          cellId: selection.target.cellIds[0]!,
          message: "Updated the chart.",
          durationMs: 4_000,
        },
      }),
    );
    act(() => resolutionListener?.(event));
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

    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();

    void act(() => vi.advanceTimersByTime(4_179));
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
    void act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")?.textContent).toContain(
      "S1AddressedUpdated the chart.",
    );

    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.reveal",
        revision: 4,
        payload: {
          cellId: selection.target.cellIds[0]!,
          message: "Showing the finished chart.",
          durationMs: 4_000,
        },
      }),
    );
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
    void act(() => vi.advanceTimersByTime(4_180));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).not.toBeNull();

    const receipt = document.querySelector<HTMLButtonElement>(
      "[data-marimo-lens-resolution-receipt]",
    );
    act(() => receipt?.focus());

    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.start",
        revision: 4,
        payload: {
          cellId: selection.target.cellIds[0]!,
          label: "Checking another cell",
        },
      }),
    );
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
    void act(() => vi.advanceTimersByTime(16));
    expect(document.activeElement).toBe(document.querySelector("[data-ml-select]"));

    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.reveal",
        revision: 4,
        payload: {
          cellId: selection.target.cellIds[0]!,
          durationMs: 4_000,
        },
      }),
    );
    void act(() => vi.advanceTimersByTime(4_180));
    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
  });

  test("presents a newly addressed receipt after timed activity finishes", () => {
    vi.useFakeTimers();
    let attentionListener: ((event: CellAttentionEvent) => void) | undefined;
    let resolutionListener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const event = resolvedEvent({ summary: "Updated the chart." });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol: protocolClient({
        onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
          attentionListener = next;
          return vi.fn();
        }),
        onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
          resolutionListener = next;
          return vi.fn();
        }),
      }),
    };
    currentModelFor = () => model;
    const cell = document.createElement("section");
    cell.id = `cell-${selection.target.cellIds[0]}`;
    cell.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    cell.scrollIntoView = vi.fn();
    document.body.appendChild(cell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<MarimoLensContent />));

    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.activity.start",
        revision: 3,
        payload: {
          cellId: selection.target.cellIds[0]!,
          durationMs: 4_000,
          label: "Updating chart",
        },
      }),
    );
    act(() => resolutionListener?.(event));
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

    expect(document.querySelector("[data-marimo-lens-cell-attention]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();

    void act(() => vi.advanceTimersByTime(4_120));

    expect(document.querySelector("[data-marimo-lens-cell-attention]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")?.textContent).toContain(
      "S1AddressedUpdated the chart.",
    );
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
      state: lensState({
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: second.id,
        selections: [first, second],
        history: [],
      }),
      css: "",
      selector: null,
      protocol: protocolClient({
        onSelectionResolved,
      }),
    };
    currentModelFor = () => model;
    const invalidateSnapshotCapture = vi.fn();
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      invalidateSnapshotCapture,
    });
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
    const protocol = protocolClient({
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: first.id,
        selections: [first, second],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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
    const protocol = protocolClient({
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S3",
        currentSelectionId: first.id,
        selections: [first, second],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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

  test("moves focus from a resolved marker while its receipt waits for a reveal", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    let attentionListener: ((event: CellAttentionEvent) => void) | undefined;
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const output = document.createElement("div");
    let outputTop = 20;
    output.id = `output-${selection.target.cellIds[0]}`;
    output.getBoundingClientRect = () => new DOMRect(20, outputTop, 400, 240);
    output.scrollIntoView = vi.fn(() => {
      outputTop = 300;
    });
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    document.body.appendChild(output);
    const protocol = protocolClient({
      onCellAttention: vi.fn((next: (event: CellAttentionEvent) => void) => {
        attentionListener = next;
        return vi.fn();
      }),
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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
    act(() =>
      attentionListener?.({
        protocol: "marimo-lens.event",
        version: 3,
        type: "cell.reveal",
        revision: 3,
        payload: {
          cellId: selection.target.cellIds[0]!,
          message: "Showing the completed output.",
          durationMs: 4_000,
        },
      }),
    );

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

    expect(
      document.querySelector(
        "[data-marimo-lens-cell-attention], [data-marimo-lens-cell-attention-notice]",
      ),
    ).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("[data-ml-dock-tab]"));
  });

  test("preserves focus outside the resolved selection", () => {
    let listener: ((event: SelectionResolvedEvent) => void) | undefined;
    const selection = selectionFixture();
    const protocol = protocolClient({
      onSelectionResolved: vi.fn((next: (event: SelectionResolvedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
    });
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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
    const protocol = protocolClient();
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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
    const protocol = protocolClient();
    let model = {
      state: lensState({
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: selection.id,
        selections: [selection],
        history: [],
      }),
      css: "",
      selector: null,
      protocol,
    };
    currentModelFor = () => model;

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

type ResolvedEventOptions = {
  revision?: number;
  selectionId?: string;
  label?: string;
  summary?: string;
  selections?: SelectionResolvedEvent["payload"]["selections"];
};

function resolvedEvent(overrides: ResolvedEventOptions = {}): SelectionResolvedEvent {
  const {
    revision = 4,
    selectionId = "selection-1",
    label = "S1",
    summary,
    selections = [{ selectionId, label, resolutionRevision: revision }],
  } = overrides;
  const payload: SelectionResolvedEvent["payload"] = { selections };
  if (summary) payload.summary = summary;
  return {
    protocol: "marimo-lens.event",
    version: 3,
    type: "selection.resolved",
    revision,
    payload,
  };
}

function addressedReceipt(selection: Selection, event: SelectionResolvedEvent): AddressedSelection {
  const resolved = event.payload.selections.find(({ selectionId }) => selectionId === selection.id);
  const receipt: AddressedSelection = {
    selectionId: selection.id,
    label: selection.label,
    note: selection.note,
    target: selection.target,
    createdAt: selection.createdAt,
    addressedAt: "2026-07-23T08:00:00Z",
    anchor: selection.anchor,
    resolutionRevision: resolved?.resolutionRevision ?? event.revision,
  };
  if (selection.domHint) receipt.domHint = selection.domHint;
  if (event.payload.summary) receipt.summary = event.payload.summary;
  return receipt;
}

function lensState(state: LensState): LensState {
  return state;
}

type ProtocolOverrides = {
  onCellAttention?: LensProtocolClient["onCellAttention"];
  onOutputCapture?: LensProtocolClient["onOutputCapture"];
  onSelectionResolved?: LensProtocolClient["onSelectionResolved"];
};

function protocolClient(overrides: ProtocolOverrides = {}): LensProtocolClient {
  const model: LensWidgetModel = {
    get: () =>
      lensState({
        revision: 0,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      }),
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  };
  const protocol = new LensProtocolClient(model, window);
  vi.spyOn(protocol, "getSnapshot").mockResolvedValue({
    snapshot: {
      status: "available",
      id: "image:selection-1",
      mediaType: "image/png",
      width: 800,
      height: 600,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-14T10:01:00Z",
    },
    bytes: new Uint8Array([137, 80, 78, 71]),
  });
  vi.spyOn(protocol, "onCellAttention").mockImplementation(
    overrides.onCellAttention ?? (() => () => undefined),
  );
  vi.spyOn(protocol, "onOutputCapture").mockImplementation(
    overrides.onOutputCapture ?? (() => () => undefined),
  );
  vi.spyOn(protocol, "onSelectionResolved").mockImplementation(
    overrides.onSelectionResolved ?? (() => () => undefined),
  );
  return protocol;
}

function requireCaptureHandler(handler: OutputCaptureHandler | undefined): OutputCaptureHandler {
  if (!handler) throw new Error("Expected output capture handler registration");
  return handler;
}

function outputCaptureCommand(): OutputCaptureCommand {
  return {
    protocol: "marimo-lens.command",
    version: 3,
    requestId: "capture-1",
    type: "output.capture",
    payload: { outputCellId: "cell-1" },
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
  for (let index = 0; index < 10 && captureOutput.mock.calls.length < callCount; index += 1) {
    frames.flushNext();
    await Promise.resolve();
  }
  expect(captureOutput).toHaveBeenCalledTimes(callCount);
}
