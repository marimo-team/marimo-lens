import { afterEach, describe, expect, test } from "vitest";

import { cellElement } from "@/lib/cell-regions";

describe("cellElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("data-cell-id");
  });

  test("resolves marimo output, cell, raw id, and data-cell-id anchors", () => {
    document.body.innerHTML = `
      <section id="output-cell-a"></section>
      <section id="cell-cell-b"></section>
      <section id="cell-c"></section>
      <section data-cell-id="cell-d"></section>
    `;
    for (const element of document.querySelectorAll("section")) {
      mockRect(element, { width: 140, height: 42 });
    }

    expect(cellElement("cell-a")?.id).toBe("output-cell-a");
    expect(cellElement("cell-b")?.id).toBe("cell-cell-b");
    expect(cellElement("cell-c")?.id).toBe("cell-c");
    expect(cellElement("cell-d")?.getAttribute("data-cell-id")).toBe("cell-d");
  });

  test("can prefer the full cell container for cell-level receipts", () => {
    document.body.innerHTML = `
      <section id="cell-cell-a"></section>
      <section id="output-cell-a"></section>
    `;
    const cell = document.getElementById("cell-cell-a");
    const output = document.getElementById("output-cell-a");
    if (!cell || !output) throw new Error("missing test fixture");
    mockRect(cell, { width: 720, height: 220 });
    mockRect(output, { width: 420, height: 80 });

    expect(cellElement("cell-a")?.id).toBe("output-cell-a");
    expect(cellElement("cell-a", "cell")?.id).toBe("cell-cell-a");
  });

  test("returns a usable cell ancestor instead of a zero-size anchor", () => {
    document.body.innerHTML = `
      <section data-cell-id="cell-a">
        <div id="output-cell-a"></div>
      </section>
    `;
    const cell = document.querySelector("[data-cell-id='cell-a']");
    const output = document.getElementById("output-cell-a");
    if (!cell || !output) throw new Error("missing test fixture");
    mockRect(output, { width: 120, height: 0 });
    mockRect(cell, { width: 640, height: 180 });

    expect(cellElement("cell-a")).toBe(cell);
  });

  test("rejects zero-size anchors instead of creating phantom overlay targets", () => {
    document.body.innerHTML = `<section id="output-cell-a"></section>`;
    const output = document.getElementById("output-cell-a");
    if (!output) throw new Error("missing test fixture");
    mockRect(output, { width: 0, height: 0 });

    expect(cellElement("cell-a")).toBeNull();
  });
});

function mockRect(element: Element, size: { width: number; height: number }) {
  element.getBoundingClientRect = () => new DOMRect(24, 32, size.width, size.height);
}
