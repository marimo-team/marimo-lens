import { afterEach, expect, test } from "vite-plus/test";

import { targetFromElement } from "@/notebook/selection-target";
import { targetInfo } from "@/notebook/target-info";

afterEach(() => document.body.replaceChildren());

test("composed source labels respect the name and detail bounds", () => {
  document.body.innerHTML = `
    <span id="a" data-marimo-lens-cell-id="data" data-marimo-lens-label="${"a".repeat(200)}"
      data-marimo-lens-detail="${"c".repeat(300)}"></span>
    <span id="b" data-marimo-lens-cell-id="data" data-marimo-lens-label="${"b".repeat(200)}"
      data-marimo-lens-detail="${"d".repeat(300)}"></span>
    <section data-marimo-lens-inputs="a b"></section>
  `;
  const region = document.querySelector("section")!;
  region.getBoundingClientRect = () => new DOMRect(10, 10, 100, 100);
  const target = targetFromElement(region, "section")!;
  expect(targetInfo(target)).toEqual({
    label: `${"a".repeat(200)} · ${"b".repeat(53)}`,
    detail: `${"c".repeat(300)} · ${"d".repeat(209)}`,
  });
});

test("an output-less cell is labeled by its cell ID over editor chrome labels", () => {
  document.body.innerHTML = `
    <div id="cell-rates" data-cell-id="rates">
      <button aria-label="Run cell"></button>
      <div class="cm-line">discount_rate = 0.07</div>
    </div>
  `;
  const cell = document.getElementById("cell-rates")!;
  cell.getBoundingClientRect = () => new DOMRect(0, 0, 400, 60);
  const target = targetFromElement(cell.querySelector(".cm-line"), null)!;
  expect(targetInfo(target)).toEqual({ label: "Cell rates" });
});
