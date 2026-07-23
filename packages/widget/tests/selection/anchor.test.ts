import { describe, expect, test } from "vite-plus/test";

import {
  anchorToViewport,
  isAnchorInsideOutputViewport,
  resizeRectAnchor,
  translateAnchor,
} from "@/selection/anchor";

function outputElement(): HTMLElement {
  const output = document.createElement("div");
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 300 },
    scrollLeft: { configurable: true, value: 40, writable: true },
    scrollTop: { configurable: true, value: 30, writable: true },
  });
  output.getBoundingClientRect = () => new DOMRect(100, 50, 200, 150);
  return output;
}

describe("selection anchor geometry", () => {
  test("maps normalized content coordinates through output scrolling", () => {
    expect(anchorToViewport(outputElement(), { kind: "point", x: 0.5, y: 0.5 })).toEqual({
      kind: "point",
      x: 260,
      y: 170,
    });
  });

  test("keeps saved markers inside the visible output viewport", () => {
    const output = outputElement();

    expect(isAnchorInsideOutputViewport(output, { kind: "point", x: 0.5, y: 0.5 })).toBe(true);
    expect(isAnchorInsideOutputViewport(output, { kind: "point", x: 0.1, y: 0.05 })).toBe(false);
    expect(
      isAnchorInsideOutputViewport(output, {
        kind: "rect",
        x: 0.1,
        y: 0.05,
        width: 0.4,
        height: 0.4,
      }),
    ).toBe(false);
  });

  test("moves rectangles while keeping their extents inside the output", () => {
    expect(
      translateAnchor(
        outputElement(),
        { kind: "rect", x: 0.75, y: 0.7, width: 0.2, height: 0.25 },
        100,
        100,
      ),
    ).toEqual({ kind: "rect", x: 0.8, y: 0.75, width: 0.2, height: 0.25 });
  });

  test("resizes corners without crossing the opposite edge or output bounds", () => {
    const output = outputElement();
    expect(
      resizeRectAnchor(
        output,
        { kind: "rect", x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        "se",
        300,
        300,
      ),
    ).toEqual({ kind: "rect", x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
    const collapsed = resizeRectAnchor(
      output,
      { kind: "rect", x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      "nw",
      300,
      300,
    );
    expect(collapsed.width).toBeCloseTo(12 / 400);
    expect(collapsed.height).toBeCloseTo(12 / 300);
  });
});
