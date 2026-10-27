import { describe, expect, test } from "vite-plus/test";

import { sheetView } from "@/app/sheet-view";
import { INITIAL_UI_STATE } from "@/selection/state";

import { historyEntryFixture, historyFixture } from "../support/fixtures";

const open = { ...INITIAL_UI_STATE, sheetOpen: true };

describe("requests sheet view", () => {
  test("shows History when the requested Open tab has nothing to list", () => {
    const view = sheetView(open, 0, historyFixture([historyEntryFixture()]));

    expect(view).toMatchObject({ open: true, tab: "history" });
  });

  test("shows Open when History has nothing to list", () => {
    const view = sheetView({ ...open, sheetTab: "history" }, 2, historyFixture());

    expect(view).toMatchObject({ open: true, tab: "open" });
  });

  test("hides a sheet with nothing on either tab", () => {
    expect(sheetView(open, 0, historyFixture()).open).toBe(false);
    expect(sheetView(open, 0, null).open).toBe(false);
  });

  test("keeps a requested tab that has something to list", () => {
    const view = sheetView(
      { ...open, sheetTab: "history" },
      1,
      historyFixture([historyEntryFixture()]),
    );

    expect(view).toMatchObject({ open: true, tab: "history" });
  });
});
