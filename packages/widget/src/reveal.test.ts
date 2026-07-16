import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { revealSelection } from "@/reveal";
import { selectionFixture } from "@/test-fixtures";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selection reveal", () => {
  test("scrolls an offscreen output and leaves a visible output in place", () => {
    const scrollIntoView = vi.fn();
    const output = setupOutput(new DOMRect(0, 1_200, 400, 200), scrollIntoView);
    const selection = selectionFixture();

    expect(revealSelection(selection, "smooth")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });

    output.getBoundingClientRect = () => new DOMRect(0, 100, 400, 200);
    expect(revealSelection(selection, "smooth")).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("uses immediate scrolling for keyboard and reduced-motion activation", () => {
    const scrollIntoView = vi.fn();
    setupOutput(new DOMRect(0, 1_200, 400, 200), scrollIntoView);
    const selection = selectionFixture();

    revealSelection(selection, "instant");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    revealSelection(selection, "smooth");

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

function setupOutput(rect: DOMRect, scrollIntoView: ReturnType<typeof vi.fn>): HTMLElement {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => rect;
  output.scrollIntoView = scrollIntoView as HTMLElement["scrollIntoView"];
  document.body.appendChild(output);
  return output;
}
