import { describe, expect, test } from "vitest";

import { resolveColumnWindow } from "@/components/target-column-pager";

describe("resolveColumnWindow", () => {
  test("shows every column when the full names fit", () => {
    expect(
      resolveColumnWindow({
        availableWidth: 280,
        chipWidths: [60, 72, 80],
        requestedStartIndex: 2,
      }),
    ).toEqual({
      endIndex: 3,
      hasNext: false,
      hasPrevious: false,
      overflowing: false,
      startIndex: 0,
    });
  });

  test("steps a contiguous visible window when names overflow", () => {
    expect(
      resolveColumnWindow({
        availableWidth: 210,
        chipWidths: [80, 60, 90, 70],
        requestedStartIndex: 0,
      }),
    ).toEqual({
      endIndex: 2,
      hasNext: true,
      hasPrevious: false,
      overflowing: true,
      startIndex: 0,
    });

    expect(
      resolveColumnWindow({
        availableWidth: 210,
        chipWidths: [80, 60, 90, 70],
        requestedStartIndex: 1,
      }),
    ).toEqual({
      endIndex: 2,
      hasNext: true,
      hasPrevious: true,
      overflowing: true,
      startIndex: 1,
    });
  });

  test("reserves room for the remaining column cue", () => {
    expect(
      resolveColumnWindow({
        availableWidth: 210,
        chipWidths: [80, 60, 90, 70],
        remainingLabelWidth: 0,
        requestedStartIndex: 1,
      }).endIndex,
    ).toBe(3);

    expect(
      resolveColumnWindow({
        availableWidth: 210,
        chipWidths: [80, 60, 90, 70],
        requestedStartIndex: 1,
      }).endIndex,
    ).toBe(2);
  });

  test("keeps one full column visible when a name is wider than the viewport", () => {
    expect(
      resolveColumnWindow({
        availableWidth: 120,
        chipWidths: [180, 40],
        requestedStartIndex: 0,
      }),
    ).toEqual({
      endIndex: 1,
      hasNext: true,
      hasPrevious: false,
      overflowing: true,
      startIndex: 0,
    });
  });

  test("clamps the requested start index", () => {
    expect(
      resolveColumnWindow({
        availableWidth: 150,
        chipWidths: [60, 60, 60],
        requestedStartIndex: 99,
      }),
    ).toEqual({
      endIndex: 3,
      hasNext: false,
      hasPrevious: true,
      overflowing: true,
      startIndex: 2,
    });
  });
});
