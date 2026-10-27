import { act, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensActions, LensMeta, LensSheet, LensState } from "@/context/lens-context";

import { LensDock } from "@/dock/lens-dock";
import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";

import {
  addressedSelectionFixture,
  resolvedEventFixture,
  selectionFixture,
} from "../support/fixtures";
import { LensTestProvider, lensActions, lensMeta, lensState } from "../support/lens";
import { render } from "../support/render";

let notebookDom: NotebookDomAdapter | null = null;
let frames: FrameRequestCallback[] = [];

// The dock moves focus in the next animation frame, once the control it
// focuses has rendered.
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

afterEach(() => {
  notebookDom?.dispose();
  notebookDom = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

type StateOverrides = Parameters<typeof lensState>[0];

describe("Lens dock", () => {
  test.each([
    {
      state: {
        selections: [selectionFixture(), selectionFixture({ id: "selection-2", label: "S2" })],
      },
      label: "2 open, 0 in history",
      collapsed: "2 open selections, 0 in history",
    },
    {
      state: { history: [addressedSelectionFixture()] },
      label: "0 open, 1 in history",
      collapsed: "0 open selections, 1 in history",
    },
  ])(
    "names the counts on Selections and the collapsed dock: $label",
    ({ state, label, collapsed }) => {
      renderDock(state);

      expect(findButton(`Open selections, ${label}`)).not.toBeNull();
      act(() => findButton("Collapse Lens")?.click());
      expect(findButton(`Open Lens, ${collapsed}`)).not.toBeNull();
    },
  );

  test("moves focus between the expanded and collapsed entry points without arming", () => {
    renderStatefulDock();
    expect(findButton("Select a target")?.textContent).toBe("Select");

    act(() => findButton("Collapse Lens")!.click());
    nextFrame();

    const open = findButton("Open Lens")!;
    expect(document.activeElement).toBe(open);
    act(() => open.click());
    nextFrame();

    const select = findButton("Select a target");
    expect(document.activeElement).toBe(select);
    expect(select?.getAttribute("aria-pressed")).toBe("false");
  });

  test("keeps Option or Alt+L as a one-way entry into selection mode", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    renderStatefulDock();
    input.focus();

    const enter = pressLensShortcut(input);
    expect(enter.defaultPrevented).toBe(true);
    nextFrame();
    let select = findButton("Cancel selection mode")!;
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.getAttribute("aria-keyshortcuts")).toContain("Alt+L");

    const repeat = pressLensShortcut(select, { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(select.getAttribute("aria-pressed")).toBe("true");

    input.focus();
    const refocus = pressLensShortcut(input);
    expect(refocus.defaultPrevented).toBe(true);
    nextFrame();
    select = findButton("Cancel selection mode")!;
    expect(document.activeElement).toBe(select);

    act(() => findButton("Collapse Lens")?.click());
    nextFrame();
    const open = findButton("Open Lens")!;
    expect(document.activeElement).toBe(open);

    pressLensShortcut(open);
    nextFrame();
    select = findButton("Cancel selection mode")!;
    expect(document.activeElement).toBe(select);
  });

  test("enters selection mode from a same-origin output iframe", () => {
    const output = document.createElement("div");
    output.id = "output-cell-1";
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
    const iframe = document.createElement("iframe");
    output.appendChild(iframe);
    document.body.appendChild(output);
    const input = iframe.contentDocument?.createElement("input");
    if (!input || !iframe.contentDocument?.body) throw new Error("Iframe fixture unavailable");
    iframe.contentDocument.body.appendChild(input);

    renderStatefulDock();
    input.focus();

    const enter = pressLensShortcut(input);
    expect(enter.defaultPrevented).toBe(true);
    nextFrame();
    expect(document.activeElement).toBe(findButton("Cancel selection mode"));
  });

  test("leaves the selection shortcut untouched while interactions are locked", () => {
    const toggleArmed = vi.fn();
    renderDock({ interactionLocked: true }, { toggleArmed });
    act(() => findButton("Collapse Lens")?.click());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const enter = pressLensShortcut(input);

    expect(enter.defaultPrevented).toBe(false);
    expect(findButton("Open Lens")).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(toggleArmed).not.toHaveBeenCalled();
  });

  test("leaves other Alt combinations available to marimo", () => {
    renderDock();

    expect(pressKey(document.body, "l", { code: "KeyL" }).defaultPrevented).toBe(false);
    expect(
      pressKey(document.body, "L", { altKey: true, code: "KeyL", shiftKey: true }).defaultPrevented,
    ).toBe(false);
  });

  test("opens the requests sheet and restores focus to its trigger", () => {
    renderStatefulDock({
      selections: [selectionFixture({ note: "" })],
      currentSelectionId: "selection-1",
    });

    const listTrigger = requestsTrigger()!;
    act(() => listTrigger.click());
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Current selection S1");
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("Cell cell-1");

    act(() => findButton("Close selections")!.click());
    nextFrame();
    expect(document.activeElement).toBe(listTrigger);
  });

  test("keeps one-shot selection mode within a stable action slot", () => {
    renderDock({ armed: true });

    const select = findButton("Cancel selection mode")!;
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.textContent).toContain("Click or drag");
    expect(select.textContent).toContain("ESC");
  });

  test("focuses rows without activation and activates through an explicit command", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const activateSelection = vi.fn();
    renderDock(
      { selections: [first, second], currentSelectionId: first.id, sheet: { open: true } },
      { activateSelection },
    );

    const secondRow = document.querySelector<HTMLButtonElement>(
      '[aria-label^="Activate selection S2"]',
    )!;
    act(() => secondRow.focus());
    expect(activateSelection).not.toHaveBeenCalled();
    act(() => secondRow.click());
    expect(activateSelection).toHaveBeenCalledWith(second, "instant");
  });

  test("moves focus between open selection rows with list navigation keys", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const third = selectionFixture({ id: "selection-3", label: "S3" });
    const activateSelection = vi.fn();
    renderDock(
      {
        selections: [first, second, third],
        currentSelectionId: second.id,
        sheet: { open: true },
      },
      { activateSelection },
    );

    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Activate selection"], button[aria-label^="Current selection"]',
      ),
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
    expect(activateSelection).not.toHaveBeenCalled();
  });

  test("leaves Tab and row action keys to their native controls", () => {
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      sheet: { open: true },
    });

    const row = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Current selection S1"]',
    )!;
    const edit = findButton("Edit note for S1")!;
    expect(pressKey(row, "Tab").defaultPrevented).toBe(false);

    act(() => edit.focus());
    expect(pressKey(edit, "ArrowDown").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(edit);
  });

  test("keeps the dock focused on selecting and opening selections", () => {
    renderDock({ selections: [selectionFixture()], currentSelectionId: "selection-1" });

    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-marimo-lens-dockbar] button"),
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Move Lens",
      "Select a target",
      "Open selections, 1 open, 0 in history",
      "Collapse Lens",
    ]);
  });

  test("exposes stable browser selectors on the dock and its sheet", () => {
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      sheet: { open: true },
    });

    expect(document.querySelector("[data-marimo-lens-dock]")).not.toBeNull();
    expect(document.querySelector("[data-ml-select]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-selection-list]")).not.toBeNull();
  });

  test("keeps bulk clearing in the requests sheet", () => {
    const clearSelections = vi.fn();
    renderDock(
      {
        selections: [selectionFixture()],
        currentSelectionId: "selection-1",
        sheet: { open: true },
      },
      { clearSelections },
    );

    act(() => findButton("Clear selections")?.click());
    expect(clearSelections).toHaveBeenCalledOnce();
  });

  test("keeps selection rows uniform when a note has not been added", () => {
    const noted = selectionFixture({ note: "Make this red" });
    const unnoted = selectionFixture({ id: "selection-2", label: "S2", note: "" });
    renderDock({
      selections: [noted, unnoted],
      currentSelectionId: noted.id,
      sheet: { open: true },
    });

    const notedRow = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-focus="${noted.id}"]`,
    )!;
    const unnotedRow = document.querySelector<HTMLElement>(
      `[data-marimo-lens-selection-focus="${unnoted.id}"]`,
    )!;

    expect(notedRow.textContent).toContain(noted.note);
    expect(notedRow.textContent).toContain(`Cell ${noted.target.cellIds[0]}`);
    expect(unnotedRow.textContent).toContain("No note added");
    expect(unnotedRow.textContent).toContain(`Cell ${unnoted.target.cellIds[0]}`);
  });

  test("keeps History accessible when no requests remain", () => {
    const receipt = addressedSelectionFixture({
      note: "Keep the complete original request visible in history.",
      summary:
        "Updated the aggregation, preserved incomplete groups, and verified the rendered chart.",
    });
    const reopen = vi.fn();
    const clearHistory = vi.fn();
    renderDock(
      { history: [receipt], sheet: { open: true, tab: "history" } },
      { reopen, clearHistory },
    );

    expect(requestsTrigger()?.textContent).toContain("0");
    expect(document.querySelector<HTMLButtonElement>("#marimo-lens-open-tab")?.disabled).toBe(true);
    const summary = document.querySelector<HTMLElement>("[data-marimo-lens-history-summary]")!;
    expect(summary.querySelector("[data-marimo-lens-history-target]")?.textContent).toContain(
      "Cell cell-1",
    );
    expect(summary.querySelector("time")?.dateTime).toBe(receipt.addressedAt);
    const disclosure = document.querySelector<HTMLDetailsElement>(
      "[data-marimo-lens-history-disclosure]",
    )!;
    expect(disclosure.open).toBe(false);
    act(() => summary.click());
    expect(disclosure.open).toBe(true);
    const details = document.querySelector("[data-marimo-lens-history-details]")?.textContent;
    expect(details).toContain(receipt.note);
    expect(details).toContain(receipt.summary);
    expect(document.querySelector('[aria-label="Request"]')?.getAttribute("title")).toBe("Request");
    expect(document.querySelector('[aria-label="Addressed"]')?.getAttribute("title")).toBe(
      "Addressed",
    );
    act(() => summary.click());
    expect(disclosure.open).toBe(false);

    act(() => findButton("Reopen S1")?.click());
    expect(reopen).toHaveBeenCalledWith(receipt);
    act(() => findButton("Clear history")?.click());
    expect(clearHistory).toHaveBeenCalledOnce();
  });

  test("disables an empty History tab", () => {
    const setSheetTab = vi.fn();
    renderDock(
      {
        selections: [selectionFixture()],
        currentSelectionId: "selection-1",
        sheet: { open: true },
      },
      { setSheetTab },
    );

    const historyTab = document.querySelector<HTMLButtonElement>("#marimo-lens-history-tab")!;
    expect(historyTab.disabled).toBe(true);
    act(() => historyTab.click());
    expect(setSheetTab).not.toHaveBeenCalled();
  });

  test("focuses the addressed row named by a resolution receipt", () => {
    const first = addressedSelectionFixture();
    const focused = addressedSelectionFixture({
      selectionId: "selection-2",
      label: "S2",
      resolutionRevision: 6,
    });
    renderDock({
      history: [first, focused],
      sheet: { open: true, tab: "history", focusedHistoryRevision: focused.resolutionRevision },
    });

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reopen S2");
  });

  test("marks a History entry already restored to Open", () => {
    const selection = selectionFixture();
    renderDock({
      selections: [selection],
      history: [addressedSelectionFixture({ selectionId: selection.id })],
      currentSelectionId: selection.id,
      sheet: { open: true, tab: "history" },
    });

    expect(findButton("S1 is open")?.disabled).toBe(true);
    expect(findButton("S1 is open")?.textContent).toBe("Open");
  });

  test.each([
    { anchor: { kind: "point" as const, x: 0.2, y: 0.2 }, accessibleName: "Point selection" },
    {
      anchor: { kind: "rect" as const, x: 0.2, y: 0.2, width: 0.4, height: 0.3 },
      accessibleName: "Region selection",
    },
  ])("names $accessibleName in History", ({ anchor, accessibleName }) => {
    renderDock({
      history: [addressedSelectionFixture({ anchor })],
      sheet: { open: true, tab: "history" },
    });

    expect(document.querySelector("svg title")?.textContent).toBe(accessibleName);
  });

  test("expands the collapsed dock when its receipt opens History", () => {
    const openResolution = vi.fn();
    const event = resolutionEvent();
    renderDock({ history: [addressedSelectionFixture()], receipt: event }, { openResolution });

    act(() => findButton("Collapse Lens")?.click());
    act(() => findButton("Open history for S1")?.click());
    expect(openResolution).toHaveBeenCalledWith(event);
    expect(findButton("Collapse Lens")).not.toBeNull();
  });

  test("moves between status tabs with standard tablist keys", () => {
    renderStatefulDock({
      selections: [selectionFixture()],
      history: [addressedSelectionFixture()],
      currentSelectionId: "selection-1",
      sheet: { open: true },
    });

    const open = document.querySelector<HTMLButtonElement>("#marimo-lens-open-tab")!;
    const history = document.querySelector<HTMLButtonElement>("#marimo-lens-history-tab")!;
    expect(open.tabIndex).toBe(0);
    expect(history.tabIndex).toBe(-1);

    act(() => {
      open.focus();
      open.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });

    expect(history.getAttribute("aria-selected")).toBe("true");
    expect(history.tabIndex).toBe(0);
    expect(document.activeElement).toBe(history);
  });

  test("keeps a detached selection actionable and labels its unavailable target", () => {
    const selection = selectionFixture();
    const activateSelection = vi.fn();
    const editNote = vi.fn();
    const deleteSelection = vi.fn();
    renderDock(
      {
        selections: [selection],
        currentSelectionId: selection.id,
        availableSelectionIds: new Set(),
        sheet: { open: true },
      },
      { activateSelection, editNote, deleteSelection },
    );

    const summary = document.querySelector<HTMLButtonElement>('[aria-label*="target unavailable"]');
    expect(summary?.textContent).toContain("Target unavailable");
    expect(summary?.getAttribute("aria-current")).toBe("true");
    expect(findButton("View image for S1.")?.disabled).toBe(false);
    expect(findButton("Edit note for S1")?.disabled).toBe(false);
    expect(findButton("Remove selection S1")?.disabled).toBe(false);

    act(() => summary?.click());
    expect(activateSelection).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Edit note for S1")?.click());
    expect(editNote).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Remove selection S1")?.click());
    expect(deleteSelection).toHaveBeenCalledWith(selection);
  });

  test("gives the external notice slot to current cell attention", () => {
    renderDock(
      { receipt: resolutionEvent() },
      {},
      {},
      <div data-test-attention-notice>Cell cell-1</div>,
    );

    expect(document.querySelector("[data-test-attention-notice]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-resolution-receipt]")).toBeNull();
  });
});

/** A dock whose arming, sheet, and tab change the way the app changes them. */
function StatefulDock({ initial }: { initial: StateOverrides }) {
  const [armed, setArmed] = useState(initial?.armed ?? false);
  const [sheet, setSheet] = useState<Partial<LensSheet>>(initial?.sheet ?? {});
  const state = lensState({ ...initial, armed, sheet });
  const actions = lensActions({
    toggleArmed: () => setArmed((active) => !active),
    toggleSheet: () => setSheet((current) => ({ ...current, open: !current.open })),
    setSheetTab: (tab) => setSheet((current) => ({ ...current, tab })),
  });
  return (
    <LensTestProvider state={state} actions={actions}>
      <LensDock />
    </LensTestProvider>
  );
}

function renderStatefulDock(initial: StateOverrides = {}) {
  mount(<StatefulDock initial={initial} />);
}

function renderDock(
  state: StateOverrides = {},
  actions: Partial<LensActions> = {},
  meta: Partial<LensMeta> = {},
  notice?: ReactNode,
) {
  const value: LensState = lensState(state);
  mount(
    <LensTestProvider state={value} actions={lensActions(actions)} meta={lensMeta(meta)}>
      <LensDock notice={notice} />
    </LensTestProvider>,
  );
}

function mount(children: ReactNode) {
  notebookDom ??= new NotebookDomAdapter(document);
  render(<NotebookDomProvider adapter={notebookDom}>{children}</NotebookDomProvider>);
}

function resolutionEvent() {
  return resolvedEventFixture({ summary: "Updated the chart." });
}

function requestsTrigger(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    'button[aria-controls="marimo-lens-selection-list"]',
  );
}

function nextFrame(): void {
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
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
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  void act(() => target.dispatchEvent(event));
  return event;
}

function pressLensShortcut(
  target: HTMLElement,
  init: Omit<KeyboardEventInit, "altKey" | "bubbles" | "cancelable" | "code" | "key"> = {},
): KeyboardEvent {
  return pressKey(target, "¬", { altKey: true, code: "KeyL", ...init });
}
