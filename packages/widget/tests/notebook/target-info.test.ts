import { afterEach, expect, test } from "vite-plus/test";

import { targetFromElement } from "@/notebook/selection-target";
import { targetInfo } from "@/notebook/target-info";

afterEach(() => document.body.replaceChildren());

test("composed source labels respect the name and detail bounds", () => {
  document.body.innerHTML = `
    <span id="a" data-runtime-cell-id="data" data-marimo-lens-label="${"a".repeat(200)}"
      data-marimo-lens-detail="${"c".repeat(300)}"></span>
    <span id="b" data-runtime-cell-id="data" data-marimo-lens-label="${"b".repeat(200)}"
      data-marimo-lens-detail="${"d".repeat(300)}"></span>
    <section data-marimo-sources="a b"></section>
  `;
  const region = document.querySelector("section")!;
  region.getBoundingClientRect = () => new DOMRect(10, 10, 100, 100);
  const target = targetFromElement(region, "section")!;
  expect(targetInfo(target)).toEqual({
    label: `${"a".repeat(200)} · ${"b".repeat(53)}`,
    detail: `${"c".repeat(300)} · ${"d".repeat(209)}`,
  });
});
