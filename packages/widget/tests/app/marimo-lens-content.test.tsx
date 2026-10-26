import type {
  AddressedSelection,
  AttentionActivityStartEvent,
  AttentionEvent,
  AttentionRevealEvent,
  LensState,
  OutputCaptureCommand,
  Selection,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import { WIDGET_TRANSPORT_VERSION } from "@marimo-lens/protocol";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensModel } from "@/anywidget/model";
import type { LensWidgetModel, OutputCaptureHandler } from "@/anywidget/transport";
import type { LensDependencies } from "@/app/use-lens-controller";
import type { UiAction } from "@/selection/state";

import { LensProtocolClient } from "@/anywidget/client";
import { MarimoLensContent as Content } from "@/app/marimo-lens-content";
import { documentIdentity } from "@/notebook/document-identity";
import { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { deferred, resolvedEventFixture, selectionFixture } from "../support/fixtures";
import { NotebookDomTestProvider } from "../support/notebook-dom";
import { render } from "../support/render";

let lens: ReturnType<typeof render> | null = null;
let currentModel: LensModel;

type ActionFactory = (dispatch: (action: UiAction) => void) => ReturnType<typeof actionsFor>;

let currentActionsFor: ActionFactory = actionsFor;
/** What each render passed to the selection actions. */
let actionInputs: Parameters<LensDependencies["useSelectionActions"]>[0][] = [];
const captureOutput = vi.fn<typeof captureOutputSnapshot>();
const dependencies: LensDependencies = {
  captureOutputSnapshot: captureOutput,
  useLensModel: () => currentModel,
  useSelectionActions: (options) => {
    actionInputs.push(options);
    return currentActionsFor(options.dispatch);
  },
};

function MarimoLensContent() {
  return (
    <NotebookDomTestProvider>
      <Content dependencies={dependencies} />
    </NotebookDomTestProvider>
  );
}

function mountContentInDocument(ownerDocument: Document) {
  const content = () => (
    <NotebookDomTestProvider ownerDocument={ownerDocument}>
      <Content dependencies={dependencies} />
    </NotebookDomTestProvider>
  );
  const documentView = render(content(), ownerDocument);
  return { render: () => documentView.rerender(content()), unmount: documentView.unmount };
}

afterEach(() => {
  lens = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  captureOutput.mockReset();
  currentActionsFor = actionsFor;
  actionInputs = [];
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
  };
}

describe("marimo-lens content", () => {
  test("navigates transient Trail events and ignores stale cancellation", () => {
    vi.useFakeTimers();
    const trail = {
      id: "tour",
      steps: [
        {
          address: { kind: "cell" as const, cellId: "first" },
          label: "Question",
          message: "Start here.",
        },
        { address: { kind: "cell" as const, cellId: "second" }, label: "Answer" },
      ],
    };
    for (const id of ["first", "second"]) target(`cell-${id}`, new DOMRect(20, 200, 500, 200));
    const view = mount({ state: canonicalState({ revision: 0 }) });
    const button = (label: string) => query<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    view.emit(reveal(trail));
    const next = button("Next trail step");
    expect(indicator()!.contains(next)).toBe(true);
    expect(indicator()!.dataset.targetLabel).toBe("first");
    expect(next.closest('[aria-hidden="true"]')).toBeNull();
    expect(button("Previous trail step").getAttribute("aria-disabled")).toBe("true");
    act(() => button("Previous trail step").click());
    expect(indicator()!.dataset.targetLabel).toBe("first");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(button("Next trail step")).not.toBeNull();
    act(() => next.click());
    expect(uiRoot().activeElement).toBe(next);
    expect(indicator()!.dataset.targetLabel).toBe("second");
    expect(document.getElementById("cell-second")?.scrollIntoView).toHaveBeenCalled();
    expect(button("Next trail step").getAttribute("aria-disabled")).toBe("true");
    act(() => next.click());
    expect(indicator()!.dataset.targetLabel).toBe("second");
    act(() => {
      button("Previous trail step").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(button("Previous trail step").getAttribute("aria-disabled")).toBe("true");
    expect(indicator()!.dataset.targetLabel).toBe("first");
    act(() => button("End trail").click());
    expect(button("Next trail step")).toBeNull();
    view.emit(reveal({ ...trail, id: "fresh" }));
    view.emit(trailStop("tour"));
    expect(button("Next trail step")).not.toBeNull();
    view.emit(trailStop("fresh"));
    expect(button("Next trail step")).toBeNull();
    view.emit(reveal({ id: "held", steps: [trail.steps[0]!] }));
    expect(button("Next trail step")).toBeNull();
    expect(button("Previous trail step")).toBeNull();
    expect(button("Dismiss reveal")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(button("Dismiss reveal")).not.toBeNull();
    act(() => button("Dismiss reveal").click());
    expect(indicator()).toBeNull();
  });

  test("captures the exact canonical output for a reverse protocol request", async () => {
    const frames = controlledAnimationFrames();
    const release = vi.fn();
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    captureOutput.mockResolvedValue(availableCapture("image:capture-1"));
    const capture = mountCapture(release);
    const controller = new AbortController();
    const pending = capture(controller.signal);

    expect(captureOutput).not.toHaveBeenCalled();
    document.body.appendChild(output);
    frames.flushNext();
    await expect(pending).resolves.toEqual({
      image: expect.objectContaining({ id: "image:capture-1" }),
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(captureOutput).toHaveBeenCalledWith({
      imageId: "image:capture-1",
      output,
      signal: controller.signal,
    });

    lens?.unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  test("reports missing and failed output capture through stable protocol errors", async () => {
    const frames = controlledAnimationFrames();
    const capture = mountCapture();

    const missing = capture();
    frames.flushNext();
    await expect(missing).rejects.toMatchObject({ code: "output_unavailable" });

    target("output-cell-1", new DOMRect(20, 20, 400, 240));
    captureOutput.mockRejectedValue(new Error("Canvas rendering is unavailable"));

    const failed = capture();
    frames.flushNext();
    await expect(failed).rejects.toMatchObject({
      message: "Canvas rendering is unavailable",
    });
  });

  test("cancels the next-paint barrier when the active view unmounts", async () => {
    const frames = controlledAnimationFrames();
    const controller = new AbortController();
    const capture = mountCapture(() =>
      controller.abort(new DOMException("Lens view released", "AbortError")),
    );
    const rejection = expect(capture(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    lens?.unmount();

    expect(controller.signal.aborted).toBe(true);
    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(captureOutput).not.toHaveBeenCalled();
    await rejection;
  });

  test("rejects a capture when the canonical output root changes", async () => {
    const frames = controlledAnimationFrames();
    const output = target("output-cell-1", new DOMRect(20, 20, 400, 240));
    const pending = deferred<Awaited<ReturnType<typeof captureOutputSnapshot>>>();
    captureOutput.mockImplementationOnce(() => pending.promise);
    const capture = mountCapture();

    const rejection = expect(capture()).rejects.toMatchObject({ code: "capture_failed" });
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
    currentActionsFor = (dispatch) => ({
      ...actionsFor(dispatch),
      activateSelection: (selectionId: string) => {
        activateSelection(selectionId);
        dispatch({ type: "selectionActivated", selectionId });
      },
    });
    mount({ state: canonicalState({ selections: [selection], current: null }) });

    await act(async () => {
      query<HTMLButtonElement>("[data-ml-list]")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = query<HTMLButtonElement>('[aria-label^="Activate selection S1"]');
    act(() => row?.click());

    expect(activateSelection).toHaveBeenCalledWith(selection.id);
    expect(row?.getAttribute("aria-current")).toBe("true");
    expect(query("[data-marimo-lens-status]")?.textContent).toBe("Target unavailable.");
  });

  test("resolves targets with a selector that changes after mount", () => {
    target("summary", new DOMRect(20, 20, 400, 240));
    const selection = selectionFixture({
      target: domTarget("#summary"),
      snapshot: { status: "failed", capturedAt: "2026-07-14T12:00:00Z", error: "Unavailable." },
    });
    const view = mount({ state: canonicalState({ revision: 1, selections: [selection] }) });
    const marker = () => query(`[data-marimo-lens-selection-id="${selection.id}"]`);
    expect(marker()).toBeNull();

    view.update({ selector: "#summary" });
    expect(marker()).not.toBeNull();

    view.update({ selector: null });
    expect(marker()).toBeNull();
  });

  test("reveals a waiting selection once a new selector matches its target", () => {
    const summary = target("summary");
    const selection = selectionFixture({ target: domTarget("#summary") });
    const view = mount({ state: canonicalState({ selections: [selection] }) });
    view.emit(selectionReveal(selection.id));
    expect(indicator()).toBeNull();

    view.update({ selector: "#summary" });

    expect(summary.scrollIntoView).toHaveBeenCalledOnce();
    expect(indicator()?.dataset.targetLabel).toBe("S1");
  });

  test("routes a cell reveal and preserves dock state and focus", () => {
    vi.useFakeTimers();
    const cell = target("cell-BYtC", new DOMRect(20, 80, 400, 300));
    const outside = document.createElement("button");
    document.body.append(outside);
    const view = mount({ state: canonicalState({ revision: 7 }) });
    outside.focus();

    view.emit(
      reveal({
        id: "reveal-1",
        steps: [{ address: { kind: "cell", cellId: "BYtC" }, message: "Updated the aggregation." }],
        durationMs: 4_000,
      }),
    );

    expect(query("[data-marimo-lens-dock]")?.getAttribute("data-expanded")).toBe("true");
    expect(cell.scrollIntoView).toHaveBeenCalledOnce();
    expect(new NotebookDomAdapter(document).activeElement).toBe(outside);
    expect(query("[data-marimo-lens-target-attention-notice]")).toBeNull();
    expect(indicator()?.dataset.targetKind).toBe("cell");
    expect(indicator()?.dataset.targetLabel).toBe("BYtC");
    expect(query("[data-marimo-lens-target-attention-status]")?.textContent).toBe(
      "Revealed cell BYtC. Updated the aggregation.",
    );
  });

  test("reveals the selected projection when one cell backs two visible targets", () => {
    const rect = new DOMRect(20, 80, 400, 240);
    const first = target("projection-first", rect, { className: "lens-target" });
    first.dataset.marimoLensCellId = "cell-shared";
    const selected = target("projection-selected", new DOMRect(460, 80, 400, 240), {
      className: "lens-target",
    });
    for (const cellId of ["cell-shared", "cell-detail"]) {
      const producer = document.createElement("span");
      producer.dataset.marimoLensCellId = cellId;
      selected.appendChild(producer);
    }
    const selection = selectionFixture({
      target: {
        ...domTarget("#projection-selected"),
        sources: [
          { cellId: "cell-detail", selector: null },
          { cellId: "cell-shared", selector: null },
        ],
        cellIds: ["cell-detail", "cell-shared"],
      },
    });
    const view = mount({
      state: canonicalState({ selections: [selection] }),
      selector: ".lens-target",
    });

    view.emit(selectionReveal(selection.id));

    expect(selected.scrollIntoView).toHaveBeenCalledOnce();
    expect(first.scrollIntoView).not.toHaveBeenCalled();
    expect(indicator()?.dataset.targetKind).toBe("selection");
    expect(indicator()?.dataset.targetLabel).toBe("S1");
  });

  test("preserves attention order while waiting for selection state", () => {
    target("authored-summary", new DOMRect(20, 80, 400, 240), { className: "lens-target" });
    target("cell-newer", new DOMRect(20, 360, 400, 240));
    const selection = selectionFixture({ target: domTarget("#authored-summary") });
    const view = mount({ state: canonicalState({ revision: 2 }), selector: ".lens-target" });

    view.emit(
      activity({ activityId: "activity-authored", address: selectionAddress(selection.id) }),
    );
    view.emit(cellActivity("newer"));
    expect(indicator()).toBeNull();

    view.update({ state: canonicalState({ selections: [selection] }) });

    expect(indicator()?.dataset.targetKind).toBe("cell");
    expect(indicator()?.dataset.targetLabel).toBe("newer");
  });

  test("presents queued selection attention after a skipped model revision", () => {
    target("authored-summary", new DOMRect(20, 80, 400, 240), { className: "lens-target" });
    const selection = selectionFixture({ target: domTarget("#authored-summary") });
    const view = mount({ state: canonicalState({ revision: 2 }), selector: ".lens-target" });

    view.emit(
      activity({ activityId: "activity-authored", address: selectionAddress(selection.id) }),
    );

    view.update({ state: canonicalState({ revision: 4, selections: [selection] }) });

    expect(indicator()?.dataset.targetKind).toBe("selection");
    expect(indicator()?.dataset.targetLabel).toBe("S1");
  });

  test("presents activity against a stored notebook selection", () => {
    const selection = selectionFixture();
    const output = target(`output-${selection.target.cellIds[0]}`, new DOMRect(20, 80, 400, 240));
    const view = mount({ state: canonicalState({ selections: [selection] }) });

    view.emit(
      activity({ activityId: "activity-notebook", address: selectionAddress(selection.id) }),
    );

    expect(indicator()?.dataset.targetKind).toBe("selection");
    expect(indicator()?.dataset.targetLabel).toBe("S1");

    view.emit(selectionReveal(selection.id));
    expect(output.scrollIntoView).toHaveBeenCalledOnce();
  });

  test("keeps selection activity while an authored target is replaced", () => {
    vi.useFakeTimers();
    const selection = selectionFixture({ target: domTarget("#authored-summary") });
    const view = mount({
      state: canonicalState({ selections: [selection] }),
      selector: ".lens-target",
    });
    const authored = target("authored-summary", new DOMRect(20, 80, 400, 240), {
      className: "lens-target",
    });

    view.emit(
      activity({
        activityId: "activity-authored",
        address: selectionAddress(selection.id),
        label: "Updating page",
      }),
    );
    expect(indicator()).not.toBeNull();

    act(() => {
      authored.remove();
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(20);
    });
    expect(indicator()).toBeNull();
    expect(query("[data-marimo-lens-target-attention-notice]")).not.toBeNull();

    target("authored-summary", new DOMRect(20, 80, 400, 240), { className: "lens-target" });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(20);
    });
    expect(indicator()).not.toBeNull();
    expect(query("[data-marimo-lens-target-attention-notice]")).toBeNull();
  });

  test("preserves pending attention for each document", () => {
    const primaryFrame = document.createElement("iframe");
    const secondaryFrame = document.createElement("iframe");
    document.body.append(primaryFrame, secondaryFrame);
    const primaryDocument = primaryFrame.contentDocument!;
    const secondaryDocument = secondaryFrame.contentDocument!;
    expect(primaryDocument.location.pathname).toBe(secondaryDocument.location.pathname);
    const rect = new DOMRect(20, 80, 400, 240);
    target("primary-target", rect, { className: "lens-target", ownerDocument: primaryDocument });
    target("secondary-target", rect, {
      className: "lens-target",
      ownerDocument: secondaryDocument,
    });
    const primarySelection = selectionFixture({
      id: "selection-primary",
      label: "S1",
      target: domTarget("#primary-target", primaryDocument),
    });
    const secondarySelection = selectionFixture({
      id: "selection-secondary",
      label: "S2",
      target: domTarget("#secondary-target", secondaryDocument),
    });
    const attention = eventStream<AttentionEvent>();
    currentModel = lensModel({
      state: canonicalState({ revision: 2 }),
      selector: ".lens-target",
      protocol: protocolClient({ onAttention: attention.subscribe }),
    });
    const primary = mountContentInDocument(primaryDocument);
    const secondary = mountContentInDocument(secondaryDocument);

    act(() => {
      attention.emit(
        activity({
          activityId: "activity-primary",
          address: selectionAddress(primarySelection.id),
        }),
      );
      attention.emit(
        activity({
          activityId: "activity-secondary",
          address: selectionAddress(secondarySelection.id),
        }),
      );
    });
    expect(indicator(primaryDocument)).toBeNull();
    expect(indicator(secondaryDocument)).toBeNull();

    currentModel = {
      ...currentModel,
      state: canonicalState({
        selections: [primarySelection, secondarySelection],
        current: secondarySelection.id,
      }),
    };
    primary.render();
    secondary.render();

    expect(indicator(primaryDocument)?.dataset.targetLabel).toBe("S1");
    expect(query("[data-marimo-lens-target-attention-notice]", primaryDocument)).toBeNull();
    expect(indicator(secondaryDocument)?.dataset.targetLabel).toBe("S2");
    primary.unmount();
    secondary.unmount();
  });

  test.each([
    { name: "stops showing a target whose output disappears", configured: false, removed: true },
    { name: "shows a configured target from the first render", configured: true, removed: false },
  ])("$name", ({ configured, removed }) => {
    const output = target(configured ? "summary" : "output-cell-1", new DOMRect(20, 20, 400, 240));
    const selection = selectionFixture({
      target: configured ? domTarget("#summary") : selectionFixture().target,
      snapshot: { status: "pending" },
    });
    mount({
      state: canonicalState({ revision: 1, selections: [selection] }),
      selector: configured ? "#summary" : null,
    });
    if (removed) {
      act(() => {
        output.remove();
        lens?.root.render(<MarimoLensContent />);
      });
    }

    // Capture settlement reads availability in the render it runs after.
    const shown = actionInputs.map(({ availableSelectionIds }) =>
      availableSelectionIds.has(selection.id),
    );
    expect(shown[0]).toBe(true);
    expect(shown.at(-1)).toBe(!removed);
    expect(query(`[data-marimo-lens-selection-id="${selection.id}"]`) !== null).toBe(!removed);
  });

  test("presents and announces a resolution only after canonical state removes it", () => {
    vi.useFakeTimers();
    const selection = selectionFixture();
    const invalidateSnapshotCapture = vi.fn();
    currentActionsFor = (dispatch) => ({ ...actionsFor(dispatch), invalidateSnapshotCapture });
    const view = mount({ state: canonicalState({ selections: [selection] }) });

    const event = resolvedEvent({ summary: "Updated the chart." });
    view.resolve(event);

    expect(invalidateSnapshotCapture).toHaveBeenCalledWith(selection.id);
    expect(receipt()).toBeNull();
    expect(query("[data-marimo-lens-status]")?.textContent).toBe("");

    view.update({
      state: canonicalState({ revision: 4, history: [addressedReceipt(selection, event)] }),
    });

    expect(receipt()?.textContent).toContain("S1AddressedUpdated the chart.");
    expect(receipt()?.closest("[aria-live]")).toBeNull();
    expect(query("[data-marimo-lens-status]")?.textContent).toBe(
      "S1 addressed. Updated the chart.",
    );
    expect(query("[data-marimo-lens-selection-list]")).toBeNull();

    const presented = receipt();
    act(() => presented?.focus());
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(receipt()).not.toBeNull();

    act(() => presented?.click());
    expect(query('[role="tab"][aria-selected="true"]')?.textContent).toContain("History");
    expect(new NotebookDomAdapter(document).activeElement?.getAttribute("aria-label")).toBe(
      "Reopen S1",
    );

    view.resolve(
      resolvedEvent({
        revision: 3,
        selections: [selectionFixture({ id: "selection-old", label: "S9" })],
      }),
    );
    expect(receipt()?.dataset.selectionId).toBe("selection-1");

    act(() => {
      vi.advanceTimersByTime(5_999);
    });
    expect(receipt()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(receipt()).toBeNull();
  });

  test.each([false, true])("reveals before receipt (coalesced=%s)", (coalesced) => {
    vi.useFakeTimers();
    const selection = selectionFixture();
    const cellId = selection.target.cellIds[0]!;
    const event = resolvedEvent({ summary: "Updated the chart." });
    target(`output-${cellId}`);
    const view = mount({ state: canonicalState({ selections: [selection] }) });

    const trail = reveal({
      id: "reveal-1",
      steps: [
        { address: selectionAddress(selection.id), message: "Updated the chart." },
        { address: { kind: "cell", cellId }, message: "The producing cell." },
      ],
      durationMs: 4_000,
    });
    if (!coalesced) view.emit(trail);
    view.set({
      state: canonicalState({ revision: 4, history: [addressedReceipt(selection, event)] }),
    });
    act(() => {
      if (coalesced) view.attention.emit(trail);
      view.resolutions.emit(event);
      lens?.root.render(<MarimoLensContent />);
    });

    expect(indicator()).not.toBeNull();
    expect(receipt()).toBeNull();
    act(() => query<HTMLButtonElement>('[aria-label="Next trail step"]')!.click());
    expect(indicator()?.textContent).toContain("The producing cell.");

    void act(() => vi.advanceTimersByTime(4_000));
    expect(receipt()).toBeNull();
    void act(() => vi.runOnlyPendingTimers());
    expect(indicator()).toBeNull();
    expect(receipt()?.textContent).toContain("S1AddressedUpdated the chart.");

    view.emit(
      reveal({
        id: "reveal-1",
        steps: [{ address: { kind: "cell", cellId }, message: "Showing the finished chart." }],
        durationMs: 4_000,
      }),
    );
    expect(receipt()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4_000);
      vi.runOnlyPendingTimers();
    });
    expect(indicator()).toBeNull();
    expect(receipt()).not.toBeNull();

    act(() => receipt()?.focus());

    view.emit(
      activity({
        activityId: "activity-3",
        address: { kind: "cell", cellId },
        label: "Checking another cell",
      }),
    );
    expect(receipt()).toBeNull();
    void act(() => vi.advanceTimersToNextFrame());
    expect(new NotebookDomAdapter(document).activeElement).toBe(query("[data-ml-select]"));

    view.emit(
      reveal({ id: "reveal-1", steps: [{ address: { kind: "cell", cellId } }], durationMs: 4_000 }),
    );
    act(() => {
      vi.advanceTimersByTime(4_000);
      vi.runOnlyPendingTimers();
    });
    expect(indicator()).toBeNull();
    expect(receipt()).toBeNull();
  });

  test.each([
    { name: "completed activity", kind: "activity", revision: 4, owned: true },
    { name: "an earlier resolution", kind: "reveal", revision: 3, owned: true },
    { name: "another document", kind: "reveal", revision: 4, owned: false },
  ] as const)("ignores delayed attention for $name", ({ kind, revision, owned }) => {
    const selection = owned
      ? selectionFixture()
      : selectionFixture({
          target: { ...selectionFixture().target, documentId: "another-document" },
        });
    const history = [addressedReceipt(selection, resolvedEvent({ revision }))];
    const view = mountHeldReveal(canonicalState({ revision: 4, history }));
    view.emit(
      kind === "activity"
        ? activity({ address: selectionAddress(selection.id), activityId: "completed-activity" })
        : selectionReveal(selection.id),
    );
    expect(view.output.scrollIntoView).not.toHaveBeenCalled();
    expect(indicator()).toBeNull();
  });

  test("presents a resolution receipt only in the selection's document", () => {
    const primaryFrame = document.createElement("iframe");
    const secondaryFrame = document.createElement("iframe");
    document.body.append(primaryFrame, secondaryFrame);
    const primaryDocument = primaryFrame.contentDocument!;
    const secondaryDocument = secondaryFrame.contentDocument!;
    target("secondary-target", new DOMRect(20, 80, 400, 240), {
      className: "lens-target",
      ownerDocument: secondaryDocument,
    });
    const selection = selectionFixture({
      target: domTarget("#secondary-target", secondaryDocument),
    });
    const event = resolvedEvent();
    const resolutions = eventStream<SelectionResolvedEvent>();
    currentModel = lensModel({
      state: canonicalState({ selections: [selection] }),
      selector: ".lens-target",
      protocol: protocolClient({ onSelectionResolved: resolutions.subscribe }),
    });
    const primary = mountContentInDocument(primaryDocument);
    const secondary = mountContentInDocument(secondaryDocument);

    act(() => resolutions.emit(event));
    currentModel = {
      ...currentModel,
      state: canonicalState({ revision: 4, history: [addressedReceipt(selection, event)] }),
    };
    primary.render();
    secondary.render();

    expect(query("[data-marimo-lens-resolution-receipt]", primaryDocument)).toBeNull();
    expect(
      query("[data-marimo-lens-resolution-receipt]", secondaryDocument)?.textContent,
    ).toContain("S1Addressed");
    primary.unmount();
    secondary.unmount();
  });

  test("presents a newly addressed receipt after timed activity finishes", () => {
    vi.useFakeTimers();
    const selection = selectionFixture();
    const cellId = selection.target.cellIds[0]!;
    const event = resolvedEvent({ summary: "Updated the chart." });
    target(`cell-${cellId}`);
    const view = mount({ state: canonicalState({ selections: [selection] }) });

    view.emit(
      activity({
        activityId: "activity-4",
        address: { kind: "cell", cellId },
        durationMs: 4_000,
        label: "Updating chart",
      }),
    );
    view.resolve(event);
    view.update({
      state: canonicalState({ revision: 4, history: [addressedReceipt(selection, event)] }),
    });

    expect(indicator()).not.toBeNull();
    expect(receipt()).toBeNull();

    void act(() => vi.advanceTimersByTime(4_120));

    expect(indicator()).toBeNull();
    expect(receipt()?.textContent).toContain("S1AddressedUpdated the chart.");
  });

  test("reconciles one resolution receipt for an atomic batch", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const invalidateSnapshotCapture = vi.fn();
    currentActionsFor = (dispatch) => ({ ...actionsFor(dispatch), invalidateSnapshotCapture });
    const view = mount({
      state: canonicalState({ selections: [first, second], current: second.id }),
    });

    const event = resolvedEvent({
      selections: [first, second],
      summary: "Updated and verified both requests.",
    });
    view.resolve(event);

    expect(invalidateSnapshotCapture.mock.calls.map(([selectionId]) => selectionId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(receipt()).toBeNull();

    view.update({
      state: canonicalState({
        revision: 4,
        history: [addressedReceipt(first, event), addressedReceipt(second, event)],
      }),
    });

    expect(receipt()?.textContent).toContain(
      "2 selectionsAddressedUpdated and verified both requests.",
    );
    expect(query("[data-marimo-lens-status]")?.textContent).toBe(
      "2 selections addressed. Updated and verified both requests.",
    );
  });

  test("keeps the receipt inside an open requests sheet", async () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const view = mount({ state: canonicalState({ selections: [first, second] }) });
    await openRequestsSettled();

    view.resolve(resolvedEvent());
    view.set({
      state: canonicalState({
        revision: 4,
        selections: [second],
        history: [addressedReceipt(first, resolvedEvent())],
      }),
    });
    await act(async () => {
      lens?.root.render(<MarimoLensContent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const sheet = query("[data-marimo-lens-selection-list]");
    expect(sheet).not.toBeNull();
    expect(receipt()).not.toBeNull();
    expect(sheet?.contains(receipt())).toBe(true);
  });

  test("moves focus from a resolved selection to the current fallback", async () => {
    const frames = queuedFrames();
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const view = mount({ state: canonicalState({ selections: [first, second] }) });
    await openRequestsSettled();
    act(() =>
      query<HTMLButtonElement>(`[data-marimo-lens-selection-focus="${first.id}"]`)?.focus(),
    );

    view.resolve(resolvedEvent());
    view.set({
      state: canonicalState({
        revision: 4,
        selections: [second],
        history: [addressedReceipt(first, resolvedEvent())],
      }),
    });
    await act(async () => {
      lens?.root.render(<MarimoLensContent />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      frames.flush();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(new NotebookDomAdapter(document).activeElement).toBe(
      query(`[data-marimo-lens-selection-focus="${second.id}"]`),
    );
  });

  test("moves focus from a resolved marker while its receipt waits for a reveal", () => {
    const frames = queuedFrames();
    const selection = selectionFixture();
    const cellId = selection.target.cellIds[0]!;
    const output = document.createElement("div");
    let outputTop = 20;
    output.id = `output-${cellId}`;
    output.getBoundingClientRect = () => new DOMRect(20, outputTop, 400, 240);
    output.scrollIntoView = vi.fn(() => {
      outputTop = 300;
    });
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    document.body.appendChild(output);
    const view = mount({ state: canonicalState({ selections: [selection] }) });
    act(() => query<HTMLButtonElement>('[aria-label="Collapse Lens"]')?.click());
    act(() => frames.flush());
    act(() =>
      query<HTMLButtonElement>(`[data-marimo-lens-selection-id="${selection.id}"]`)?.focus(),
    );
    view.emit(
      reveal({
        id: "reveal-1",
        steps: [{ address: { kind: "cell", cellId }, message: "Showing the completed output." }],
        durationMs: 4_000,
      }),
    );

    view.resolve(resolvedEvent());
    view.update({
      state: canonicalState({
        revision: 4,
        history: [addressedReceipt(selection, resolvedEvent())],
      }),
    });
    act(() => frames.flush());

    expect(
      query("[data-marimo-lens-target-attention], [data-marimo-lens-target-attention-notice]"),
    ).not.toBeNull();
    expect(receipt()).toBeNull();
    expect(new NotebookDomAdapter(document).activeElement).toBe(query("[data-ml-dock-tab]"));
  });

  test("preserves focus outside the resolved selection", () => {
    const unrelated = document.createElement("button");
    document.body.appendChild(unrelated);
    const selection = selectionFixture();
    const view = mount({ state: canonicalState({ selections: [selection] }) });
    unrelated.focus();

    view.resolve(resolvedEvent());
    view.update({
      state: canonicalState({
        revision: 4,
        history: [addressedReceipt(selection, resolvedEvent())],
      }),
    });

    expect(new NotebookDomAdapter(document).activeElement).toBe(unrelated);
  });

  test("ends the note when its selection closes, so a reopened selection opens no editor", () => {
    const withSelection = canonicalState({ selections: [selectionFixture()] });
    const view = mount({ state: withSelection });
    click("[data-ml-list]");
    click('[aria-label="Edit note for S1"]');
    expect(query("[data-marimo-lens-note-editor]")).not.toBeNull();

    view.update({ state: canonicalState({ revision: 4 }) });
    expect(query("[data-marimo-lens-note-editor]")).toBeNull();
    expect(query<HTMLButtonElement>("[data-ml-select]")?.disabled).toBe(false);

    view.update({ state: { ...withSelection, revision: 5 } });
    expect(query("[data-marimo-lens-note-editor]")).toBeNull();
  });

  test("keeps History showing when selections arrive after Open emptied", () => {
    const selection = selectionFixture();
    const history = [addressedReceipt(selectionFixture({ id: "selection-old" }), resolvedEvent())];
    const view = mount({ state: canonicalState({ selections: [selection], history }) });
    click("[data-ml-list]");
    view.update({ state: canonicalState({ revision: 4, history }) });
    view.update({
      state: canonicalState({
        revision: 5,
        selections: [selectionFixture({ id: "selection-2", label: "S2" })],
        history,
      }),
    });

    expect(query('[role="tab"][aria-selected="true"]')?.textContent).toContain("History");
  });

  test("keeps the requests sheet closed after its final row disappears", () => {
    const selection = selectionFixture();
    const view = mount({ state: canonicalState({ selections: [selection] }) });
    click("[data-ml-list]");
    expect(query("[data-marimo-lens-selection-list]")).not.toBeNull();

    view.update({ state: canonicalState({ revision: 4 }) });
    view.update({ state: canonicalState({ revision: 5, selections: [selection] }) });

    expect(query("[data-marimo-lens-selection-list]")).toBeNull();
  });
});

type CanonicalStateOptions = {
  revision?: number;
  selections?: Selection[];
  current?: string | null;
  history?: AddressedSelection[];
};

function canonicalState({
  revision = 3,
  selections = [],
  current = selections[0]?.id ?? null,
  history = [],
}: CanonicalStateOptions = {}): LensState {
  return {
    revision,
    nextLabel: `S${selections.length + 1}`,
    currentSelectionId: current,
    selections,
    history,
  };
}

function lensModel(overrides: Partial<LensModel> = {}): LensModel {
  return {
    state: canonicalState(),
    css: "",
    selector: null,
    protocol: protocolClient(),
    ...overrides,
  };
}

/**
 * Render Lens with a model whose protocol delivers the returned attention and
 * resolution streams. `set` replaces model fields for a render the caller
 * performs inside its own `act`.
 */
function mount(initial: Partial<LensModel> = {}) {
  const attention = eventStream<AttentionEvent>();
  const resolutions = eventStream<SelectionResolvedEvent>();
  currentModel = lensModel({
    protocol: protocolClient({
      onAttention: attention.subscribe,
      onSelectionResolved: resolutions.subscribe,
    }),
    ...initial,
  });
  const set = (next: Partial<LensModel>) => {
    currentModel = { ...currentModel, ...next };
  };
  const mounted = render(<MarimoLensContent />);
  lens = mounted;
  const rerender = () => mounted.rerender(<MarimoLensContent />);
  return {
    attention,
    resolutions,
    render: rerender,
    set,
    update: (next: Partial<LensModel>) => {
      set(next);
      rerender();
    },
    emit: (event: AttentionEvent) => act(() => attention.emit(event)),
    resolve: (event: SelectionResolvedEvent) => act(() => resolutions.emit(event)),
  };
}

/** Mount a Lens beside the output that a delayed selection reveal would scroll to. */
function mountHeldReveal(state: LensState, outputId = "output-cell-1") {
  const output = target(outputId);
  return { ...mount({ state }), output };
}

function mountCapture(release: () => void = vi.fn()) {
  let handler: OutputCaptureHandler | undefined;
  mount({
    state: canonicalState({ revision: 7 }),
    protocol: protocolClient({
      onOutputCapture: vi.fn((next: OutputCaptureHandler) => {
        handler = next;
        return release;
      }),
    }),
  });
  return (signal = new AbortController().signal) => {
    if (!handler) throw new Error("Expected output capture handler registration");
    return handler(outputCaptureCommand(), signal);
  };
}

type TargetOptions = { className?: string; ownerDocument?: Document };

function target(
  id: string,
  rect = new DOMRect(20, 300, 400, 240),
  { className, ownerDocument = document }: TargetOptions = {},
): HTMLElement {
  const element = ownerDocument.createElement("section");
  element.id = id;
  if (className) element.className = className;
  element.getBoundingClientRect = () => rect;
  element.scrollIntoView = vi.fn();
  ownerDocument.body.appendChild(element);
  return element;
}

function domTarget(
  domSelector: string,
  ownerDocument = document,
): Extract<Selection["target"], { kind: "dom" }> {
  return {
    kind: "dom",
    sources: [],
    cellIds: [],
    documentId: documentIdentity(ownerDocument),
    documentPath: ownerDocument.location.pathname || "/",
    domSelector,
  };
}

const eventEnvelope = { protocol: "marimo-lens.event", version: WIDGET_TRANSPORT_VERSION } as const;

function reveal(payload: AttentionRevealEvent["payload"]): AttentionEvent {
  return { ...eventEnvelope, type: "attention.reveal", payload };
}

function activity(payload: AttentionActivityStartEvent["payload"]): AttentionEvent {
  return { ...eventEnvelope, type: "attention.activity.start", payload };
}

function trailStop(trailId: string): AttentionEvent {
  return { ...eventEnvelope, type: "attention.trail.stop", payload: { trailId } };
}

function selectionAddress(selectionId: string) {
  return { kind: "selection" as const, selectionId, revision: 3 };
}

function selectionReveal(selectionId: string): AttentionEvent {
  return reveal({
    id: "reveal-1",
    steps: [{ address: selectionAddress(selectionId) }],
    durationMs: 4_000,
  });
}

function cellActivity(cellId: string): AttentionEvent {
  return activity({ activityId: "activity-cell", address: { kind: "cell", cellId } });
}

function resolvedEvent(overrides: Parameters<typeof resolvedEventFixture>[0] = {}) {
  return resolvedEventFixture({ revision: 4, ...overrides });
}

/** The History receipt Python stores for `selection` once `event` resolves it. */
function addressedReceipt(selection: Selection, event: SelectionResolvedEvent): AddressedSelection {
  const resolved = event.payload.selections.find(({ selectionId }) => selectionId === selection.id);
  const receipt: AddressedSelection = {
    selectionId: selection.id,
    description: selection.description,
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

function eventStream<Event>() {
  const listeners = new Set<(event: Event) => void>();
  return {
    subscribe: (listener: (event: Event) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event: Event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

type ProtocolOverrides = {
  onAttention?: LensProtocolClient["onAttention"];
  onOutputCapture?: LensProtocolClient["onOutputCapture"];
  onSelectionResolved?: LensProtocolClient["onSelectionResolved"];
};

function protocolClient(overrides: ProtocolOverrides = {}): LensProtocolClient {
  const model: LensWidgetModel = {
    get: () => canonicalState({ revision: 0 }),
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
  vi.spyOn(protocol, "onAttention").mockImplementation(
    overrides.onAttention ?? (() => () => undefined),
  );
  vi.spyOn(protocol, "onOutputCapture").mockImplementation(
    overrides.onOutputCapture ?? (() => () => undefined),
  );
  vi.spyOn(protocol, "onSelectionResolved").mockImplementation(
    overrides.onSelectionResolved ?? (() => () => undefined),
  );
  return protocol;
}

function outputCaptureCommand(): OutputCaptureCommand {
  return {
    protocol: "marimo-lens.command",
    version: WIDGET_TRANSPORT_VERSION,
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

function queuedFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return {
    flush: () => {
      for (const callback of frames.splice(0)) callback(0);
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

async function openRequestsSettled() {
  await act(async () => {
    query<HTMLButtonElement>("[data-ml-list]")?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(selector: string) {
  act(() => query<HTMLButtonElement>(selector)?.click());
}

function query<E extends Element = HTMLElement>(selector: string, ownerDocument = document) {
  return uiRoot(ownerDocument).querySelector<E>(selector);
}

function indicator(ownerDocument = document) {
  return query("[data-marimo-lens-target-attention]", ownerDocument);
}

function receipt() {
  return query<HTMLButtonElement>("[data-marimo-lens-resolution-receipt]");
}

function uiRoot(ownerDocument = document) {
  return ownerDocument.querySelector("[data-marimo-lens-portal]")?.shadowRoot ?? ownerDocument;
}
