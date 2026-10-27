import type { ChatRequest } from "@marimo-lens/protocol";

import { act, useState, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensActions, LensMeta, LensSheet, LensState } from "@/context/lens-context";

import { LensProtocolError } from "@/anywidget/error";
import { LensDock } from "@/dock/lens-dock";
import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";

import {
  historyEntryFixture,
  historyFixture,
  resolvedEventFixture,
  selectionFixture,
} from "../support/fixtures";
import { LensTestProvider, lensActions, lensMeta, lensState } from "../support/lens";
import { render } from "../support/render";

let notebookDom: NotebookDomAdapter | null = null;

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
        selections: [selectionFixture()],
        chats: [{ id: "chat-1", note: "Why?", openedAt: "2026-07-23T07:58:00Z" }],
      },
      label: "2 open, 0 in history",
    },
    { state: { history: historyFixture([historyEntryFixture()]) }, label: "0 open, 1 in history" },
    { state: { selections: [selectionFixture()], history: null }, label: "1 open" },
  ])("names the request counts on Requests and the collapsed dock: $label", ({ state, label }) => {
    renderDock(state);

    expect(findButton(`Requests, ${label}`)).not.toBeNull();
    act(() => findButton("Collapse Lens")?.click());
    expect(findButton(`Expand Lens, ${label}`)).not.toBeNull();
  });

  test("moves focus between the expanded and collapsed entry points without arming", () => {
    renderStatefulDock();

    act(() => findButton("Collapse Lens")!.click());

    const open = findButton("Expand Lens")!;
    expect(document.activeElement).toBe(open);
    act(() => open.click());

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
    select = findButton("Cancel selection mode")!;
    expect(document.activeElement).toBe(select);

    act(() => findButton("Collapse Lens")?.click());
    const open = findButton("Expand Lens")!;
    expect(document.activeElement).toBe(open);

    pressLensShortcut(open);
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
    expect(findButton("Expand Lens")).not.toBeNull();
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

    act(() => findButton("Close requests")!.click());
    expect(document.activeElement).toBe(listTrigger);
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

  test("lists open chat requests beside the selections and counts them", () => {
    const chat: ChatRequest = {
      id: "chat-1",
      note: "Is Central's drop real, or did the refactor lose something?",
      openedAt: "2026-07-23T07:58:00Z",
    };
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      chats: [chat],
      sheet: { open: true },
    });

    expect(document.querySelector("#marimo-lens-open-tab")?.textContent).toBe("Open 2");
    const row = document.querySelector('[data-marimo-lens-open-chat="chat-1"]');
    expect(row?.textContent).toContain(chat.note);
    expect(row?.textContent).toContain("Asked in chat");
    expect(row?.querySelector("time")?.dateTime).toBe(chat.openedAt);
  });

  test("opens on the Open tab for chat requests alone", () => {
    renderDock({
      chats: [{ id: "chat-1", note: "Why?", openedAt: "2026-07-23T07:58:00Z" }],
      history: null,
      sheet: { open: true },
    });

    expect(document.querySelector("[data-marimo-lens-open-chat]")).not.toBeNull();
    expect(findButton("Clear selections")).toBeNull();
  });

  test("keeps History accessible when no requests remain", () => {
    const entry = historyEntryFixture({
      note: "Keep the complete original request visible in history.",
      summary:
        "Updated the aggregation, preserved incomplete groups, and verified the rendered chart.",
      changes: [
        { cellId: "cell-2", name: "net_revenue", status: "in_force" },
        { cellId: "cell-3", status: "undone", undoneBy: "chat-1" },
      ],
    });
    const reopen = vi.fn();
    const revealCells = vi.fn();
    renderDock(
      { history: historyFixture([entry]), sheet: { open: true, tab: "history" } },
      { reopen, revealCells },
    );

    expect(document.querySelector<HTMLButtonElement>("#marimo-lens-open-tab")?.disabled).toBe(true);
    const summary = document.querySelector<HTMLElement>("[data-marimo-lens-history-summary]")!;
    expect(summary.querySelector("[data-marimo-lens-history-note]")?.textContent).toBe(entry.note);
    expect(summary.querySelector("[data-marimo-lens-history-target]")?.textContent).toContain(
      "Cell cell-1",
    );
    expect(summary.textContent).toContain("1 of 2 undone");
    expect(summary.querySelector("time")?.dateTime).toBe(entry.resolvedAt);
    const disclosure = document.querySelector<HTMLDetailsElement>(
      "[data-marimo-lens-history-disclosure]",
    )!;
    expect(disclosure.open).toBe(false);
    act(() => summary.click());
    expect(disclosure.open).toBe(true);
    const details = document.querySelector("[data-marimo-lens-history-details]")?.textContent;
    expect(details).toContain(entry.summary);
    expect(details).toContain("net_revenueStill applied");
    expect(details).toContain("Unnamed cellUndone by a later request");
    expect(document.querySelector("[data-marimo-lens-history-record]")?.textContent).toBe(
      "Kept in the notebook's record.",
    );

    act(() => findButton("Show cells")?.click());
    expect(revealCells).toHaveBeenCalledWith(entry);
    act(() => findButton("Reopen S1")?.click());
    expect(reopen).toHaveBeenCalledWith(entry);
  });

  test("names cells by what the notebook calls them and shows what an undone change lost", () => {
    const entry = historyEntryFixture({
      changes: [
        {
          cellId: "cell-net",
          status: "undone",
          undoneBy: "unrecorded",
          missing: ["revenue = sales + 37_800"],
        },
        { cellId: "cell-store", status: "in_force" },
      ],
    });
    renderDock({
      history: historyFixture([entry], {
        cells: [
          { id: "cell-net", name: "net_revenue", defines: ["net_revenue"] },
          { id: "cell-store", defines: ["net_by_store", "stores"] },
        ],
      }),
      sheet: { open: true, tab: "history" },
    });

    const cells = document.querySelector("[data-marimo-lens-changed-cells]")?.textContent;
    expect(cells).toContain("net_revenue");
    expect(cells).toContain("net_by_store, stores");
    expect(cells).toContain("undone by an edit made outside Lens");
    act(() => document.querySelector<HTMLElement>("[data-marimo-lens-history-summary]")!.click());
    expect(document.querySelector("[data-marimo-lens-lost-statements]")?.textContent).toBe(
      "No longer in net_revenue:revenue = sales + 37_800",
    );
  });

  test("shows a record failure in History when nothing was recorded", () => {
    renderDock({
      history: historyFixture([], { record: { status: "failed", reason: "disk full" } }),
      sheet: { open: true, tab: "history" },
    });

    expect(document.querySelector("[data-marimo-lens-history-record]")?.textContent).toBe(
      "Not saved: disk full.",
    );
  });

  test("names who undid each change in History", () => {
    const earlier = historyEntryFixture({ id: "selection-1", label: "S1" });
    const chat = historyEntryFixture({
      id: "chat-9",
      channel: "chat",
      note: "Count refunds as negative amounts instead",
      resolvedAt: "2026-07-23T08:30:00Z",
    });
    delete chat.label;
    delete chat.selection;
    const entry = historyEntryFixture({
      id: "selection-2",
      label: "S2",
      resolvedAt: "2026-07-23T09:00:00Z",
      changes: [
        { cellId: "cell-1", status: "undone", undoneBy: "selection-1" },
        { cellId: "cell-2", status: "undone", undoneBy: "unrecorded" },
        { cellId: "cell-4", status: "undone", undoneBy: "chat-9" },
        { cellId: "cell-3", status: "undone" },
        { status: "unknown" },
      ],
    });
    renderDock({
      history: historyFixture([earlier, chat, entry]),
      sheet: { open: true, tab: "history" },
    });

    const rows = Array.from(
      document.querySelectorAll(
        `[data-marimo-lens-history-key="selection-2@${entry.resolvedAt}"] [data-marimo-lens-history-change]`,
      ),
    ).map((row) => row.textContent);
    expect(rows).toEqual([
      "Unnamed cellUndone by S1",
      "Unnamed cellUndone by an edit made outside Lens",
      "Unnamed cellUndone by “Count refunds as negative amounts…”",
      "Unnamed cellUndone",
      "Cell not foundStatus unknown",
    ]);
  });

  test("loads a resolved selection's image only when its entry opens", async () => {
    const createObjectURL = vi.fn(() => "blob:marimo-lens-history");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const loadHistoryImage = vi.fn(() => Promise.resolve(bytes));
    const entry = historyEntryFixture({
      image: {
        sha256: "a".repeat(64),
        width: 320,
        height: 200,
        capturedAt: "2026-07-23T07:59:00Z",
        outdated: true,
      },
    });
    renderDock(
      { history: historyFixture([entry]), sheet: { open: true, tab: "history" } },
      {},
      { loadHistoryImage },
    );
    expect(loadHistoryImage).not.toHaveBeenCalled();

    const disclosure = document.querySelector<HTMLDetailsElement>(
      "[data-marimo-lens-history-disclosure]",
    )!;
    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle"));
    });

    expect(loadHistoryImage).toHaveBeenCalledWith("a".repeat(64));
    const image = document.querySelector<HTMLImageElement>("[data-marimo-lens-history-image] img");
    expect(image?.src).toBe("blob:marimo-lens-history");
    expect(image?.alt).toBe("S1 as the analyst saw it");
    expect(document.querySelector("[data-marimo-lens-history-image]")?.textContent).toBe(
      "Taken before the selection moved.",
    );

    await act(async () => {
      disclosure.open = false;
      disclosure.dispatchEvent(new Event("toggle"));
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:marimo-lens-history");
  });

  test.each([
    {
      failure: new LensProtocolError("history_image_not_found", "Gone"),
      shown: "missing",
      text: "The record no longer holds the image S1 showed.",
    },
    {
      failure: new LensProtocolError("request_timeout", "Timed out"),
      shown: "unavailable",
      text: "The image S1 showed could not load. Collapse and expand the entry to try again.",
    },
  ])("says when an image is $shown", async ({ failure, shown, text }) => {
    const entry = historyEntryFixture({
      image: {
        sha256: "b".repeat(64),
        width: 2,
        height: 2,
        capturedAt: "2026-07-23T07:59:00Z",
        outdated: false,
      },
    });
    renderDock(
      { history: historyFixture([entry]), sheet: { open: true, tab: "history" } },
      {},
      { loadHistoryImage: () => Promise.reject(failure) },
    );
    const disclosure = document.querySelector<HTMLDetailsElement>(
      "[data-marimo-lens-history-disclosure]",
    )!;

    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle"));
    });

    expect(document.querySelector(`[data-marimo-lens-history-image="${shown}"]`)?.textContent).toBe(
      text,
    );
  });

  test("shows chat requests as asked in chat, without Reopen", () => {
    const entry = historyEntryFixture({
      id: "chat-1",
      channel: "chat",
      note: "Drop refunds from the chart",
    });
    delete entry.label;
    delete entry.selection;
    renderDock({ history: historyFixture([entry]), sheet: { open: true, tab: "history" } });

    const chip = document.querySelector('svg[aria-label="Chat request"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("aria-hidden")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-history-note]")?.textContent).toBe(entry.note);
    expect(document.querySelector("[data-marimo-lens-history-reopen]")).toBeNull();
  });

  test("filters History to the requests that changed what the current selection shows", () => {
    const selection = selectionFixture();
    const setShapedOnly = vi.fn();
    const shaping = historyEntryFixture({
      id: "selection-old",
      label: "S7",
      shaped: [selection.id],
    });
    const elsewhere = historyEntryFixture({
      id: "selection-other",
      label: "S8",
      cellIds: ["cell-9"],
      resolvedAt: "2026-07-23T09:00:00Z",
    });
    renderDock(
      {
        selections: [selection],
        currentSelectionId: selection.id,
        history: historyFixture([shaping, elsewhere], { total: 5 }),
        sheet: { open: true, tab: "history", shapedOnly: true },
      },
      { setShapedOnly },
    );

    const keys = Array.from(
      document.querySelectorAll<HTMLElement>("[data-marimo-lens-history-key]"),
    ).map((item) => item.dataset.marimoLensHistoryKey);
    expect(keys).toEqual([`selection-old@${shaping.resolvedAt}`]);
    expect(document.querySelector("[data-marimo-lens-history-record]")?.textContent).toBe(
      "Kept in the notebook's record. 3 older requests are in it.",
    );
    const filter = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(filter.parentElement?.textContent).toBe("Only requests that changed what S1 shows");
    act(() => filter.click());
    expect(setShapedOnly).toHaveBeenCalledWith(false);
  });

  test("says when no earlier request changed what the current selection shows", () => {
    const selection = selectionFixture();
    renderDock({
      selections: [selection],
      currentSelectionId: selection.id,
      history: historyFixture([historyEntryFixture({ id: "selection-old", label: "S7" })]),
      sheet: { open: true, tab: "history", shapedOnly: true },
    });

    expect(document.querySelector("[data-marimo-lens-history-key]")).toBeNull();
    expect(document.body.textContent).toContain("No earlier request changed what S1 shows.");
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
    const first = historyEntryFixture();
    const focused = historyEntryFixture({
      id: "selection-2",
      label: "S2",
      resolvedAt: "2026-07-23T09:00:00Z",
    });
    renderDock({
      history: historyFixture([first, focused]),
      sheet: { open: true, tab: "history", focusedHistoryKey: `selection-2@${focused.resolvedAt}` },
    });

    expect(
      document.activeElement?.closest<HTMLElement>("[data-marimo-lens-history-key]")?.dataset
        .marimoLensHistoryKey,
    ).toBe(`selection-2@${focused.resolvedAt}`);
  });

  test("marks a History entry already restored to Open", () => {
    const selection = selectionFixture();
    renderDock({
      selections: [selection],
      history: historyFixture([historyEntryFixture({ id: selection.id })]),
      currentSelectionId: selection.id,
      sheet: { open: true, tab: "history" },
    });

    expect(findButton("S1 is open")?.disabled).toBe(true);
    expect(findButton("S1 is open")?.textContent).toBe("Open");
  });

  test("expands the collapsed dock when its receipt opens History", () => {
    const openResolution = vi.fn();
    const event = resolutionEvent();
    renderDock(
      { history: historyFixture([historyEntryFixture()]), receipt: event },
      { openResolution },
    );

    act(() => findButton("Collapse Lens")?.click());
    act(() => findButton("Open history for S1")?.click());
    expect(openResolution).toHaveBeenCalledWith(event);
    expect(findButton("Collapse Lens")).not.toBeNull();
  });

  test("leaves History out of the sheet when the Lens shows no History", () => {
    renderDock({ selections: [selectionFixture()], history: null, sheet: { open: true } });

    expect(document.querySelector("#marimo-lens-open-tab")?.textContent).toBe("Open 1");
    expect(document.querySelector("#marimo-lens-history-tab")).toBeNull();
    expect(document.querySelector("#marimo-lens-history-panel")).toBeNull();
  });

  test("dismisses the receipt into the dock when the Lens shows no History", () => {
    const event = resolutionEvent();
    const openResolution = vi.fn();
    const dismissReceipt = vi.fn();
    renderDock({ history: null, receipt: event }, { openResolution, dismissReceipt });

    const receipt = findButton("Dismiss receipt for S1")!;
    act(() => {
      receipt.focus();
      receipt.click();
    });

    expect(dismissReceipt).toHaveBeenCalledWith(event);
    expect(openResolution).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(findButton("Select a target"));
  });

  test("moves between status tabs with standard tablist keys", () => {
    renderStatefulDock({
      selections: [selectionFixture()],
      history: historyFixture([historyEntryFixture()]),
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
  return document.querySelector<HTMLButtonElement>('button[aria-controls="marimo-lens-requests"]');
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
