import type { SelectionAnchor } from "@marimo-lens/protocol";

import { afterEach, describe, expect, test } from "vite-plus/test";

import { anchorToViewport, currentAnchor } from "@/selection/anchor";
import { framedAnchor } from "@/selection/anchor-frame";

afterEach(() => document.body.replaceChildren());

// An output 400px wide that holds a chart with a fixed 200x100 canvas.
function chartOutput() {
  const output = document.createElement("div");
  let outputWidth = 400;
  Object.defineProperties(output, {
    offsetWidth: { configurable: true, get: () => outputWidth },
    offsetHeight: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, get: () => outputWidth },
    scrollHeight: { configurable: true, value: 100 },
  });
  output.getBoundingClientRect = () => new DOMRect(0, 0, outputWidth, 100);
  const embed = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  embed.append(canvas);
  output.append(embed);
  document.body.append(output);
  return {
    output,
    canvas,
    resize: (width: number) => {
      outputWidth = width;
    },
  };
}

describe("selection anchor frames", () => {
  test("keeps a mark on the same spot of a fixed-size chart when the output resizes", () => {
    const { output, canvas, resize } = chartOutput();
    const anchor = framedAnchor({ kind: "point", x: 0.375, y: 0.5 }, canvas, output);
    expect(anchor.frame).toEqual({
      path: "div > canvas",
      bounds: { x: 0, y: 0, width: 0.5, height: 1 },
    });

    resize(900);

    expect(anchorToViewport(output, anchor)).toEqual({ kind: "point", x: 150, y: 50 });
  });

  test("restates a framed mark in the current layout before it moves", () => {
    const { output, canvas, resize } = chartOutput();
    const anchor = framedAnchor(
      { kind: "rect", x: 0.25, y: 0.2, width: 0.125, height: 0.5 },
      canvas,
      output,
    );
    resize(800);

    expect(currentAnchor(output, anchor)).toEqual({
      kind: "rect",
      x: 0.125,
      y: 0.2,
      width: 0.0625,
      height: expect.closeTo(0.5),
      frame: { path: "div > canvas", bounds: { x: 0, y: 0, width: 0.25, height: 1 } },
    });
  });

  test("anchors on the outermost SVG across an open shadow root", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    const host = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    svg.append(bar);
    host.attachShadow({ mode: "open" }).append(svg);
    output.append(host);
    document.body.append(output);

    const anchor = framedAnchor({ kind: "point", x: 0.5, y: 0.5 }, bar, output);

    expect(anchor.frame?.path).toBe("div > ::shadow > svg");
    expect(anchorToViewport(output, anchor)).toEqual({ kind: "point", x: 200, y: 50 });
  });

  test("keeps a mark on reflowing text relative to the output", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    const paragraph = document.createElement("p");
    output.append(paragraph);
    document.body.append(output);
    const anchor: SelectionAnchor = { kind: "point", x: 0.5, y: 0.5 };

    expect(framedAnchor(anchor, paragraph, output)).toEqual(anchor);
  });

  test("falls back to the output when the frame is gone", () => {
    const { output, canvas } = chartOutput();
    const anchor = framedAnchor({ kind: "point", x: 0.25, y: 0.5 }, canvas, output);
    canvas.remove();

    expect(anchorToViewport(output, anchor)).toEqual({ kind: "point", x: 100, y: 50 });
  });
});
