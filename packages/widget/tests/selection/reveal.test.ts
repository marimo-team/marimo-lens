import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { revealSelection } from "@/selection/reveal";

import { selectionFixture } from "../support/fixtures";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selection reveal", () => {
  test("scrolls an offscreen output and leaves a visible output in place", () => {
    const scrollIntoView = vi.fn<HTMLElement["scrollIntoView"]>();
    const output = setupOutput(new DOMRect(0, 1_200, 400, 200), scrollIntoView);
    const selection = selectionFixture();
    const dom = new NotebookDomAdapter(document);

    expect(revealSelection(dom, selection, "smooth", null)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });

    output.getBoundingClientRect = () => new DOMRect(0, 100, 400, 200);
    expect(revealSelection(dom, selection, "smooth", null)).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("uses immediate scrolling for keyboard and reduced-motion activation", () => {
    const scrollIntoView = vi.fn<HTMLElement["scrollIntoView"]>();
    setupOutput(new DOMRect(0, 1_200, 400, 200), scrollIntoView);
    const selection = selectionFixture();
    const dom = new NotebookDomAdapter(document);

    revealSelection(dom, selection, "instant", null);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    revealSelection(dom, selection, "smooth", null);

    expect(scrollIntoView).toHaveBeenNthCalledWith(1, {
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
    expect(scrollIntoView).toHaveBeenNthCalledWith(2, {
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  });
});

function setupOutput(rect: DOMRect, scrollIntoView: HTMLElement["scrollIntoView"]): HTMLElement {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => rect;
  output.scrollIntoView = scrollIntoView;
  document.body.appendChild(output);
  return output;
}
