import { toSvg } from "html-to-image";
import { cloneNode } from "html-to-image/lib/clone-node";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { anchorForDetail, elementCaptureGeometry, relativeElementBounds } from "@/capture/image";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("html-to-image patch", () => {
  test("copies same-origin iframe body content once", async () => {
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeBody = iframe.contentDocument?.body;
    expect(iframeBody).toBeDefined();
    if (!iframeBody) return;

    const renderedOutput = iframe.contentDocument.createElement("div");
    renderedOutput.dataset.iframeOutput = "";
    renderedOutput.textContent = "Rendered once";
    iframeBody.appendChild(renderedOutput);

    const clone = await cloneNode(iframe, { skipFonts: true }, true);

    expect(clone?.querySelectorAll("[data-iframe-output]")).toHaveLength(1);
  });

  test("renders the live scrolled viewport with its marker at the same local point", async () => {
    vi.stubGlobal("SVGImageElement", SVGElement);
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
    const output = document.createElement("div");
    const renderedOutput = document.createElement("div");
    renderedOutput.dataset.scrolledOutput = "";
    renderedOutput.textContent = "Visible after scrolling";
    output.appendChild(renderedOutput);
    document.body.appendChild(output);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, value: 120 },
      scrollTop: { configurable: true, value: 180 },
    });
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);

    const geometry = elementCaptureGeometry(output, false);
    const dataUrl = await toSvg(output, {
      width: geometry.width,
      height: geometry.height,
      style: geometry.style,
      skipFonts: true,
    });
    const svg = new DOMParser().parseFromString(
      decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1)),
      "image/svg+xml",
    );
    const foreignObject = svg.getElementsByTagName("foreignObject")[0];
    const renderedClone = foreignObject?.firstElementChild;

    expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 400 240");
    expect(renderedClone?.getAttribute("style")).toContain("width: 800px");
    expect(renderedClone?.getAttribute("style")).toContain("height: 600px");
    expect(renderedClone?.getAttribute("style")).toContain("translate(-120px, -180px)");
    expect(renderedClone?.querySelectorAll("[data-scrolled-output]")).toHaveLength(1);

    const bounds = relativeElementBounds(output, output);
    expect(bounds).toEqual({ x: 0.15, y: 0.3, width: 0.5, height: 0.4 });
    expect(anchorForDetail({ kind: "point", x: 0.4, y: 0.5 }, bounds)).toEqual({
      kind: "point",
      x: 0.5,
      y: 0.5,
    });
  });
});
