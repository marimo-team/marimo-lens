import { describe, expect, test } from "vite-plus/test";

import {
  anchorToViewport,
  attachToNestedScroll,
  isViewportAnchorInsideOutput,
  resizeRectAnchor,
  translateAnchor,
} from "@/selection/anchor";

function outputElement(): HTMLElement {
  const output = document.createElement("div");
  Object.defineProperties(output, {
    offsetWidth: { configurable: true, value: 200 },
    offsetHeight: { configurable: true, value: 150 },
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

  test("maps saved coordinates back through output scaling", () => {
    const output = outputElement();
    output.getBoundingClientRect = () => new DOMRect(100, 50, 100, 75);

    expect(anchorToViewport(output, { kind: "point", x: 0.5, y: 0.5 })).toEqual({
      kind: "point",
      x: 180,
      y: 110,
    });
    expect(
      translateAnchor(output, { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, 40, 30),
    ).toEqual({
      kind: "rect",
      x: 0.4,
      y: 0.4,
      width: 0.2,
      height: 0.2,
    });
  });

  test("keeps saved markers inside the visible output viewport", () => {
    const output = outputElement();

    expect(isViewportAnchorInsideOutput(output, { kind: "point", x: 260, y: 170 })).toBe(true);
    expect(isViewportAnchorInsideOutput(output, { kind: "point", x: 100, y: 35 })).toBe(false);
    expect(
      isViewportAnchorInsideOutput(output, {
        kind: "rect",
        x: 100,
        y: 35,
        width: 160,
        height: 120,
      }),
    ).toBe(false);
  });

  test("keeps the baseline of an ancestor that becomes scrollable", () => {
    const output = document.createElement("div");
    const scroller = document.createElement("div");
    const content = document.createElement("div");
    scroller.style.overflow = "auto";
    scroller.appendChild(content);
    output.appendChild(scroller);
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    const attachment = attachToNestedScroll(output, content);

    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 800 });
    scroller.scrollLeft = 40;
    const refreshed = attachToNestedScroll(output, content, attachment);

    expect(refreshed.frames).toHaveLength(1);
    expect(refreshed.frames[0]?.scrollLeft).toBe(0);
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
