import type { SelectionResolvedEvent } from "@marimo-lens/protocol";

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { LensDock } from "@/ui/components/lens-dock";

import { addressedSelectionFixture, selectionFixture } from "../support/fixtures";

let root: Root | null = null;
let notebookDom: NotebookDomAdapter | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  notebookDom?.dispose();
  notebookDom = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Lens dock", () => {
  test("starts with an explicit Select action and a latched collapse control", () => {
    renderDock({ selections: [] });

    expect(document.querySelector("[data-ml-select]")?.textContent).toBe("Select");
    expect(document.querySelector("[data-ml-list]")).toBeNull();

    act(() => findButton("Collapse Lens")?.click());
    expect(findButton("Open Lens")).not.toBeNull();
    const logoImages = Array.from(
      document.querySelectorAll<HTMLImageElement>(".ml-dock-tab__logo-image"),
    );
    const logoSources = logoImages.map((image) => image.getAttribute("src") ?? "");
    expect(logoImages).toHaveLength(2);
    expect(
      logoSources.every(
        (source) => source.includes(".svg") || source.startsWith("data:image/svg+xml"),
      ),
    ).toBe(true);
    expect(new Set(logoSources).size).toBe(2);
    act(() => {
      findButton("Open Lens")?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    });
    expect(findButton("Open Lens")).not.toBeNull();
    act(() => findButton("Open Lens")?.click());
    expect(document.querySelector("[data-ml-select]")).not.toBeNull();
  });

  test("announces the selection count from the collapsed dock", () => {
    renderDock({
      selections: [selectionFixture(), selectionFixture({ id: "selection-2", label: "S2" })],
    });

    act(() => findButton("Collapse Lens")?.click());

    expect(findButton("Open Lens, 2 open selections, 0 in history")).not.toBeNull();
  });

  test("moves focus between the expanded and collapsed entry points", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    renderDock();

    const collapse = findButton("Collapse Lens")!;
    act(() => collapse.click());
    act(() => frame?.(0));

    const open = findButton("Open Lens")!;
    expect(document.activeElement).toBe(open);
    act(() => open.click());
    act(() => frame?.(0));

    expect(document.activeElement).toBe(document.querySelector("[data-ml-select]"));
  });

  test("enters selection mode globally with Option or Alt+L", () => {
    const frames: FrameRequestCallback[] = [];
    const onToggleArmed = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return 1;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withNotebookDom(<VisibilityHarness onToggle={onToggleArmed} />)));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const enter = pressLensShortcut(input);
    expect(enter.defaultPrevented).toBe(true);
    act(() => frames.shift()?.(0));
    let select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.getAttribute("aria-keyshortcuts")).toContain("Alt+L");
    expect(select.textContent).toContain("Click or drag");
    expect(findButton("Open Lens")).toBeNull();
    expect(onToggleArmed).toHaveBeenCalledOnce();

    const repeat = pressLensShortcut(select, { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(onToggleArmed).toHaveBeenCalledOnce();

    const refocus = pressLensShortcut(input);
    expect(refocus.defaultPrevented).toBe(true);
    act(() => frames.shift()?.(0));
    select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(onToggleArmed).toHaveBeenCalledOnce();

    const collapseButton = findButton("Collapse Lens")!;
    expect(collapseButton.getAttribute("aria-keyshortcuts")).toBeNull();
    act(() => collapseButton.click());
    act(() => frames.shift()?.(0));
    expect(onToggleArmed).toHaveBeenCalledTimes(2);

    const open = findButton("Open Lens")!;
    expect(document.activeElement).toBe(open);
    expect(open.getAttribute("aria-keyshortcuts")).toBe("Alt+L");
    expect(open.title).toContain("Start selection");

    pressLensShortcut(open);
    act(() => frames.shift()?.(0));
    expect(document.querySelector("[data-ml-select]")?.getAttribute("aria-pressed")).toBe("true");
    expect(onToggleArmed).toHaveBeenCalledTimes(3);
  });

  test("keeps selection mode off when expansion is interaction locked", () => {
    const onToggleArmed = vi.fn();
    renderDock({ interactionLocked: true, onToggleArmed });

    act(() => findButton("Collapse Lens")?.click());
    act(() => findButton("Open Lens")?.click());

    expect(onToggleArmed).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>("[data-ml-select]")?.disabled).toBe(true);
  });

  test("leaves other Alt combinations available to marimo", () => {
    renderDock();

    expect(pressKey(document.body, "l", { code: "KeyL" }).defaultPrevented).toBe(false);
    expect(
      pressKey(document.body, "L", { altKey: true, code: "KeyL", shiftKey: true }).defaultPrevented,
    ).toBe(false);
    expect(findButton("Collapse Lens")).not.toBeNull();
  });

  test("opens the selection sheet and restores focus to its trigger", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withNotebookDom(<DockHarness />)));

    const listTrigger = document.querySelector<HTMLButtonElement>("[data-ml-list]")!;
    act(() => listTrigger.click());
    expect(document.activeElement?.classList.contains("ml-selection-list__summary")).toBe(true);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("Cell cell-1");

    const close = findButton("Close selections")!;
    act(() => close.click());
    expect(document.activeElement).toBe(listTrigger);
  });

  test("keeps one-shot selection mode within a stable action slot", () => {
    renderDock({ armed: true });

    const select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.textContent).toContain("Click or drag");
    expect(select.textContent).toContain("ESC");
  });

  test("focuses rows without activation and activates through an explicit command", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const onActivateSelection = vi.fn();
    renderDock({
      selections: [first, second],
      currentSelectionId: first.id,
      listOpen: true,
      onActivateSelection,
    });

    const secondRow = document.querySelector<HTMLButtonElement>(
      '[aria-label^="Activate selection S2"]',
    )!;
    act(() => secondRow.focus());
    expect(onActivateSelection).not.toHaveBeenCalled();
    act(() => secondRow.click());
    expect(onActivateSelection).toHaveBeenCalledWith(second, "instant");
  });

  test("moves focus between open selection rows with list navigation keys", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const third = selectionFixture({ id: "selection-3", label: "S3" });
    const onActivateSelection = vi.fn();
    renderDock({
      selections: [first, second, third],
      currentSelectionId: second.id,
      listOpen: true,
      onActivateSelection,
    });

    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-marimo-lens-selection-focus]"),
    );
    for (const row of rows) Object.assign(row, { scrollIntoView: vi.fn() });
    expect(document.activeElement).toBe(rows[1]);

    expect(pressKey(rows[1]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[2]);
    expect(pressKey(rows[2]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[2]);
    expect(pressKey(rows[2]!, "ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[1]);
    expect(pressKey(rows[1]!, "ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[0]);
    expect(onActivateSelection).not.toHaveBeenCalled();
  });

  test("leaves Tab and row action keys to their native controls", () => {
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      listOpen: true,
    });

    const row = document.querySelector<HTMLButtonElement>("[data-marimo-lens-selection-focus]")!;
    const edit = findButton("Edit note for S1")!;
    expect(pressKey(row, "Tab").defaultPrevented).toBe(false);

    act(() => edit.focus());
    expect(pressKey(edit, "ArrowDown").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(edit);
  });

  test("keeps the dock focused on selecting and opening selections", () => {
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
    });

    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".ml-dockbar button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Select an output", "Open selections, 1 open, 0 in history", "Collapse Lens"]);
  });

  test("keeps bulk clearing in the selection sheet", () => {
    const onClearSelections = vi.fn();
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      listOpen: true,
      onClearSelections,
    });

    act(() => findButton("Clear selections")?.click());
    expect(onClearSelections).toHaveBeenCalledOnce();
  });

  test("keeps selection rows uniform when a note has not been added", () => {
    const noted = selectionFixture({ note: "Make this red" });
    const unnoted = selectionFixture({
      id: "selection-2",
      label: "S2",
      note: "",
    });
    renderDock({
      selections: [noted, unnoted],
      currentSelectionId: noted.id,
      listOpen: true,
    });

    const notedRow = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-focus="${noted.id}"]`,
    )!;
    const unnotedRow = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-focus="${unnoted.id}"]`,
    )!;

    expect(notedRow.textContent).toContain(noted.note);
    expect(notedRow.textContent).toContain(`Cell ${noted.outputCellId}`);
    expect(unnotedRow.textContent).toContain("No note added");
    expect(unnotedRow.textContent).toContain(`Cell ${unnoted.outputCellId}`);
  });

  test("keeps history accessible when no selections remain", () => {
    const receipt = addressedSelectionFixture({
      note: "Keep the complete original request visible in history.",
      summary:
        "Updated the aggregation, preserved incomplete groups, and verified the rendered chart.",
    });
    const onReopenSelection = vi.fn();
    const onClearHistory = vi.fn();
    renderDock({
      history: [receipt],
      listOpen: true,
      sheetTab: "history",
      onReopenSelection,
      onClearHistory,
    });

    expect(findButton("Open selections, 0 open, 1 in history")?.textContent).toContain("0");
    expect(document.querySelector<HTMLButtonElement>("#marimo-lens-open-tab")?.disabled).toBe(true);
    expect(document.querySelector(".ml-history-list__target")?.textContent).toContain(
      `Cell ${receipt.outputCellId}`,
    );
    expect(document.querySelector('[aria-label="Point selection"]')).not.toBeNull();

    const disclosure = document.querySelector<HTMLDetailsElement>(".ml-history-list__disclosure")!;
    const trigger = document.querySelector<HTMLElement>(".ml-history-list__row")!;
    expect(disclosure.open).toBe(false);
    expect(trigger.textContent).not.toContain(receipt.summary);
    expect(trigger.querySelector("time")?.dateTime).toBe(receipt.addressedAt);
    act(() => trigger.click());
    expect(disclosure.open).toBe(true);
    expect(document.querySelector(".ml-history-list__details")?.textContent).toContain(
      receipt.note,
    );
    expect(document.querySelector(".ml-history-list__details")?.textContent).toContain(
      receipt.summary,
    );
    expect(document.querySelector('[aria-label="Request"]')?.getAttribute("title")).toBe("Request");
    expect(document.querySelector('[aria-label="Addressed"]')?.getAttribute("title")).toBe(
      "Addressed",
    );
    act(() => trigger.click());
    expect(disclosure.open).toBe(false);

    act(() => findButton("Reopen S1")?.click());
    expect(onReopenSelection).toHaveBeenCalledWith(receipt);
    act(() => findButton("Clear history")?.click());
    expect(onClearHistory).toHaveBeenCalledOnce();
  });

  test("disables an empty History tab", () => {
    const onSheetTabChange = vi.fn();
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      listOpen: true,
      sheetTab: "open",
      onSheetTabChange,
    });

    const historyTab = document.querySelector<HTMLButtonElement>("#marimo-lens-history-tab")!;
    expect(historyTab.disabled).toBe(true);
    act(() => historyTab.click());
    expect(onSheetTabChange).not.toHaveBeenCalled();
  });

  test("focuses the addressed row named by a resolution receipt", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const first = addressedSelectionFixture();
    const focused = addressedSelectionFixture({
      selectionId: "selection-2",
      label: "S2",
      resolutionRevision: 6,
    });
    renderDock({
      history: [first, focused],
      listOpen: true,
      sheetTab: "history",
      focusedHistoryRevision: focused.resolutionRevision,
    });

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reopen S2");
  });

  test("marks a history receipt already restored to Open", () => {
    const selection = selectionFixture();
    renderDock({
      selections: [selection],
      history: [addressedSelectionFixture({ selectionId: selection.id })],
      currentSelectionId: selection.id,
      listOpen: true,
      sheetTab: "history",
    });

    expect(findButton("S1 is open")?.disabled).toBe(true);
    expect(findButton("S1 is open")?.textContent).toBe("Open");
  });

  test("represents region history with its compact selection mark", () => {
    renderDock({
      history: [
        addressedSelectionFixture({
          anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.4, height: 0.3 },
        }),
      ],
      listOpen: true,
      sheetTab: "history",
    });

    expect(document.querySelector('[aria-label="Region selection"]')).not.toBeNull();
  });

  test("opens exact history from the transient addressed receipt", () => {
    const onOpenHistory = vi.fn();
    const event = resolutionEvent();
    renderDock({
      history: [addressedSelectionFixture()],
      resolutionReceipt: event,
      onOpenHistory,
    });

    act(() => findButton("Collapse Lens")?.click());
    expect(document.querySelector("[data-ml-dock-tab]")).not.toBeNull();
    act(() => findButton("Open history for S1")?.click());
    expect(onOpenHistory).toHaveBeenCalledWith(event);
    expect(findButton("Collapse Lens")).not.toBeNull();
  });

  test("moves between status tabs with standard tablist keys", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withNotebookDom(<TabHarness />)));

    const open = document.querySelector<HTMLButtonElement>("#marimo-lens-open-tab")!;
    const history = document.querySelector<HTMLButtonElement>("#marimo-lens-history-tab")!;
    expect(open.tabIndex).toBe(0);
    expect(history.tabIndex).toBe(-1);

    act(() => {
      open.focus();
      open.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(history.getAttribute("aria-selected")).toBe("true");
    expect(history.tabIndex).toBe(0);
    expect(document.activeElement).toBe(history);
  });

  test("keeps a detached selection actionable and labels its unavailable output", () => {
    const selection = selectionFixture();
    const onActivateSelection = vi.fn();
    const onEditNote = vi.fn();
    const onDeleteSelection = vi.fn();
    renderDock({
      selections: [selection],
      currentSelectionId: selection.id,
      availableOutputCellIds: new Set(),
      listOpen: true,
      onActivateSelection,
      onEditNote,
      onDeleteSelection,
    });

    const summary = document.querySelector<HTMLButtonElement>('[aria-label*="Output unavailable"]');
    expect(summary?.textContent).toContain("Output unavailable");
    expect(summary?.getAttribute("aria-current")).toBe("true");
    expect(findButton("View image for S1.")?.disabled).toBe(false);
    expect(findButton("Edit note for S1")?.disabled).toBe(false);
    expect(findButton("Remove selection S1")?.disabled).toBe(false);

    act(() => summary?.click());
    expect(onActivateSelection).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Edit note for S1")?.click());
    expect(onEditNote).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Remove selection S1")?.click());
    expect(onDeleteSelection).toHaveBeenCalledWith(selection);
  });

  test("keeps a transient attention notice outside the selection sheet layout", () => {
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      listOpen: true,
      cellAttentionFallback: <div data-test-attention-notice>Cell cell-1</div>,
    });

    const stack = document.querySelector(".ml-sheet-stack");
    const sheet = document.querySelector("[data-marimo-lens-selection-list]");
    const notice = document.querySelector("[data-test-attention-notice]");
    expect(stack?.contains(sheet)).toBe(true);
    expect(notice?.parentElement).toBe(stack);
    expect(sheet?.contains(notice)).toBe(false);
  });

  test("gives the external notice slot to current cell attention", () => {
    renderDock({
      resolutionReceipt: resolutionEvent(),
      cellAttentionFallback: <div data-test-attention-notice>Cell cell-1</div>,
    });

    expect(document.querySelector("[data-test-attention-notice]")).not.toBeNull();
    expect(document.querySelector("[data-test-resolution-receipt]")).toBeNull();
  });
});

function DockHarness() {
  const [listOpen, setListOpen] = useState(false);
  return (
    <LensDock
      {...defaultProps()}
      selections={[selectionFixture({ note: "" })]}
      currentSelectionId="selection-1"
      listOpen={listOpen}
      onToggleList={() => setListOpen((open) => !open)}
    />
  );
}

function VisibilityHarness({ onToggle = () => {} }: { onToggle?: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <LensDock
      {...defaultProps()}
      armed={armed}
      onToggleArmed={() => {
        onToggle();
        setArmed((active) => !active);
      }}
    />
  );
}

function TabHarness() {
  const [sheetTab, setSheetTab] = useState<"open" | "history">("open");
  return (
    <LensDock
      {...defaultProps()}
      selections={[selectionFixture()]}
      history={[addressedSelectionFixture()]}
      currentSelectionId="selection-1"
      listOpen
      sheetTab={sheetTab}
      onSheetTabChange={setSheetTab}
    />
  );
}

function renderDock(overrides: Partial<React.ComponentProps<typeof LensDock>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withNotebookDom(<LensDock {...defaultProps()} {...overrides} />)));
}

function withNotebookDom(children: React.ReactNode) {
  notebookDom ??= new NotebookDomAdapter(document);
  return <NotebookDomProvider adapter={notebookDom}>{children}</NotebookDomProvider>;
}

function defaultProps(): React.ComponentProps<typeof LensDock> {
  return {
    selections: [],
    history: [],
    currentSelectionId: null,
    availableOutputCellIds: new Set(),
    armed: false,
    listOpen: false,
    sheetTab: "open",
    focusedHistoryRevision: null,
    clearPending: false,
    historyClearPending: false,
    capturingSelectionIds: new Set(),
    busySelectionIds: new Set(),
    interactionLocked: false,
    onToggleArmed: () => {},
    onToggleList: () => {},
    onSheetTabChange: () => {},
    onOpenHistory: () => {},
    onClearSelections: () => {},
    onClearHistory: () => {},
    onReopenSelection: () => {},
    onActivateSelection: () => {},
    onEditNote: () => {},
    onDeleteSelection: () => {},
    snapshotLoader: new SelectionSnapshotLoader(async () => {
      throw new Error("Snapshot fixture unavailable");
    }),
  };
}

function resolutionEvent(): SelectionResolvedEvent {
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "selection.resolved",
    revision: 2,
    payload: {
      selections: [
        {
          selectionId: "selection-1",
          label: "S1",
          resolutionRevision: 2,
        },
      ],
      summary: "Updated the chart.",
    },
  };
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
    ) ?? null
  );
}

function pressKey(
  target: HTMLElement,
  key: string,
  init: Omit<KeyboardEventInit, "bubbles" | "cancelable" | "key"> = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  void act(() => target.dispatchEvent(event));
  return event;
}

function pressLensShortcut(
  target: HTMLElement,
  init: Omit<KeyboardEventInit, "altKey" | "bubbles" | "cancelable" | "code" | "key"> = {},
): KeyboardEvent {
  return pressKey(target, "¬", {
    altKey: true,
    code: "KeyL",
    ...init,
  });
}
