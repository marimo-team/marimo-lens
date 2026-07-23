import { toPng, toSvg } from "html-to-image";
import { cloneNode as cloneNodeEs } from "html-to-image/es/clone-node";
import { toPng as toPngEs } from "html-to-image/es/index";
import { cloneNode } from "html-to-image/lib/clone-node";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { anchorForDetail } from "../../src/evidence/evidence-layout";
import { relativeOutputBounds } from "../../src/evidence/geometry";
import { captureSelectionSnapshot } from "../../src/evidence/image";
import { assertCapturableIframes, elementCaptureGeometry } from "../../src/evidence/raster";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("html-to-image patch", () => {
  test("copies same-origin iframe body content once", async () => {
    mockOwnerComputedStyle(window);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    mockOwnerComputedStyle(iframe.contentWindow!);
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

  test("rejects an iframe that becomes inaccessible after capture preflight", async () => {
    for (const clone of [cloneNode, cloneNodeEs]) {
      const output = document.createElement("div");
      const iframe = document.createElement("iframe");
      output.appendChild(iframe);
      document.body.appendChild(output);
      const sourceDocument = iframe.contentDocument;
      expect(sourceDocument?.body).toBeDefined();
      assertCapturableIframes(output);
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        get: () => {
          throw new DOMException("Blocked after navigation", "SecurityError");
        },
      });

      await expect(clone(iframe, { skipFonts: true }, true)).rejects.toMatchObject({
        name: "SecurityError",
      });
      output.remove();
    }
  });

  test("resolves iframe resources before adopting the body into the notebook document", async () => {
    installOwnerRasterHarness(window as Window & typeof globalThis, true);
    const fetchResource = vi.fn().mockImplementation(
      async () =>
        new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchResource);

    const output = document.createElement("div");
    const iframe = document.createElement("iframe");
    output.appendChild(iframe);
    document.body.appendChild(output);
    mockOwnerComputedStyle(iframe.contentWindow!);

    const iframeDocument = iframe.contentDocument!;
    mockImageLoads(iframe.contentWindow!);
    const base = iframeDocument.createElement("base");
    base.href = "https://iframe.example/notebook-assets/";
    iframeDocument.head.appendChild(base);
    const chart = iframeDocument.createElement("div");
    chart.style.backgroundImage = 'url("chart-background.png")';
    iframeDocument.body.appendChild(chart);
    const chartImage = iframeDocument.createElement("img");
    chartImage.setAttribute("src", "chart-image.png");
    iframeDocument.body.appendChild(chartImage);

    const nestedIframe = iframeDocument.createElement("iframe");
    iframeDocument.body.appendChild(nestedIframe);
    mockOwnerComputedStyle(nestedIframe.contentWindow!);
    const nestedDocument = nestedIframe.contentDocument!;
    const nestedBase = nestedDocument.createElement("base");
    nestedBase.href = "https://iframe.example/nested-assets/";
    nestedDocument.head.appendChild(nestedBase);
    const nestedChart = nestedDocument.createElement("div");
    nestedChart.style.backgroundImage = 'url("nested-background.png")';
    nestedDocument.body.appendChild(nestedChart);

    await toPng(output, {
      width: 320,
      height: 180,
      pixelRatio: 1,
      skipFonts: true,
      includeStyleProperties: ["background-image", "display"],
    });

    expect(fetchResource).toHaveBeenCalledWith(
      "https://iframe.example/notebook-assets/chart-background.png",
      undefined,
    );
    expect(fetchResource).toHaveBeenCalledWith(
      "https://iframe.example/notebook-assets/chart-image.png",
      undefined,
    );
    expect(fetchResource).toHaveBeenCalledWith(
      "https://iframe.example/nested-assets/nested-background.png",
      undefined,
    );
  });

  test("renders the live scrolled viewport with its marker at the same local point", async () => {
    vi.stubGlobal("SVGImageElement", SVGElement);
    mockOwnerComputedStyle(window);
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

    const bounds = relativeOutputBounds(output, output);
    expect(bounds).toEqual({ x: 0.15, y: 0.3, width: 0.5, height: 0.4 });
    expect(anchorForDetail({ kind: "point", x: 0.4, y: 0.5 }, bounds)).toEqual({
      kind: "point",
      x: 0.5,
      y: 0.5,
    });
  });

  test("rasterizes a secondary-document root entirely in its owner realm", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frame.contentWindow! as Window & typeof globalThis;
    const harness = installOwnerRasterHarness(ownerWindow, true);
    const ambientCreateElement = vi.spyOn(document, "createElement");
    const ambientCreateElementNS = vi.spyOn(document, "createElementNS");
    const ambientStyle = vi.spyOn(window, "getComputedStyle");
    const ownerStyle = vi.spyOn(ownerWindow, "getComputedStyle");
    const ownerSerialize = vi.spyOn(ownerWindow.XMLSerializer.prototype, "serializeToString");
    const output = ownerDocument.createElement("div");
    output.textContent = "Secondary notebook output";
    ownerDocument.body.appendChild(output);
    output.getBoundingClientRect = () => new ownerWindow.DOMRect(0, 0, 480, 260);

    const dataUrl = await toPngEs(output, {
      width: 480,
      height: 260,
      pixelRatio: 1,
      skipFonts: true,
      includeStyleProperties: ["display", "color", "background-color"],
    });

    expect(dataUrl).toBe("data:image/png;base64,owner-realm");
    expect(harness.context.drawImage).toHaveBeenCalledOnce();
    expect(harness.context.drawImage.mock.calls[0]?.[0]).toBeInstanceOf(harness.ImageClass);
    expect(ownerStyle).toHaveBeenCalled();
    expect(ownerSerialize).toHaveBeenCalled();
    expect(
      ambientCreateElement.mock.calls.some(([tag]) => tag === "canvas" || tag === "style"),
    ).toBe(false);
    expect(ambientCreateElementNS).not.toHaveBeenCalled();
    expect(ambientStyle).not.toHaveBeenCalled();
  });

  test("rasterizes while the owner document is hidden", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frame.contentWindow! as Window & typeof globalThis;
    const decode = vi.fn(() => new Promise<void>(() => {}));
    const harness = installOwnerRasterHarness(ownerWindow, true, decode);
    const requestFrame = vi.fn(() => 1);
    Object.defineProperty(ownerDocument, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(ownerWindow, "requestAnimationFrame", {
      configurable: true,
      value: requestFrame,
    });
    const output = ownerDocument.createElement("div");
    output.textContent = "Backgrounded notebook output";
    ownerDocument.body.appendChild(output);

    const dataUrl = await toPngEs(output, {
      width: 320,
      height: 180,
      pixelRatio: 1,
      skipFonts: true,
      includeStyleProperties: ["display", "color"],
    });

    expect(dataUrl).toBe("data:image/png;base64,owner-realm");
    expect(harness.context.drawImage).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  test("rejects an image decode failure", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frame.contentWindow! as Window & typeof globalThis;
    const error = new ownerWindow.DOMException("Raster decode failed", "EncodingError");
    installOwnerRasterHarness(ownerWindow, true, () => Promise.reject(error));
    const output = ownerDocument.createElement("div");
    ownerDocument.body.appendChild(output);

    await expect(
      toPng(output, {
        width: 320,
        height: 180,
        pixelRatio: 1,
        skipFonts: true,
        includeStyleProperties: ["display"],
      }),
    ).rejects.toBe(error);
  });

  test("normalizes cancellation from another realm after real rasterization", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frame.contentWindow! as Window & typeof globalThis;
    const harness = installOwnerRasterHarness(ownerWindow, false);
    const output = ownerDocument.createElement("div");
    ownerDocument.body.appendChild(output);
    output.getBoundingClientRect = () => new ownerWindow.DOMRect(0, 0, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    const controller = new AbortController();
    const capture = captureSelectionSnapshot({
      selectionId: "selection-secondary",
      label: "S1",
      anchor: { kind: "point", x: 0.5, y: 0.5 },
      output,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    controller.abort(new DOMException("Closed in the parent realm", "AbortError"));
    harness.images[0]?.finishLoad();

    const error = await capture.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ownerWindow.DOMException);
    expect(error).toMatchObject({ name: "AbortError", message: "Closed in the parent realm" });
  });
});

function installOwnerRasterHarness(
  ownerWindow: Window & typeof globalThis,
  autoLoad: boolean,
  decode: () => Promise<void> = () => Promise.resolve(),
): {
  ImageClass: typeof Image;
  images: TestImage[];
  context: {
    fillStyle: string;
    fillRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
} {
  const images: TestImage[] = [];
  class OwnerImage extends ownerWindow.EventTarget {
    naturalWidth = 480;
    naturalHeight = 260;
    crossOrigin: string | null = null;
    decoding = "auto";
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    #src = "";

    decode(): Promise<void> {
      return decode();
    }

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      images.push(this);
      if (autoLoad) ownerWindow.queueMicrotask(() => this.finishLoad());
    }

    finishLoad(): void {
      this.onload?.(new ownerWindow.Event("load") as unknown as Event);
    }
  }
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  Object.defineProperty(ownerWindow, "Image", {
    configurable: true,
    value: OwnerImage,
  });
  Object.defineProperty(ownerWindow, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  vi.spyOn(ownerWindow.HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(ownerWindow.HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,owner-realm",
  );
  mockOwnerComputedStyle(ownerWindow);
  return {
    ImageClass: OwnerImage as unknown as typeof Image,
    images,
    context,
  };
}

function mockOwnerComputedStyle(ownerWindow: Window): void {
  const nativeStyle = ownerWindow.getComputedStyle.bind(ownerWindow);
  vi.spyOn(ownerWindow, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (pseudo) {
      return {
        cssText: "",
        getPropertyValue: (name: string) => (name === "content" ? "none" : ""),
        getPropertyPriority: () => "",
      } as unknown as CSSStyleDeclaration;
    }
    return nativeStyle(element);
  });
}

function mockImageLoads(ownerWindow: Window): void {
  const ownerGlobal = ownerWindow as Window & typeof globalThis;
  const descriptor = Object.getOwnPropertyDescriptor(ownerGlobal.HTMLImageElement.prototype, "src");
  if (!descriptor?.set) throw new Error("Image source setter must be available");
  vi.spyOn(ownerGlobal.HTMLImageElement.prototype, "src", "set").mockImplementation(function (
    this: HTMLImageElement,
    value: string,
  ) {
    descriptor.set?.call(this, value);
    ownerGlobal.queueMicrotask(() => this.onload?.(new ownerGlobal.Event("load")));
  });
}

type TestImage = {
  finishLoad(): void;
};
