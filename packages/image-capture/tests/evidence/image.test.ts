import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  anchorForDetail,
  composeSelectionEvidence,
  evidenceLayout,
} from "../../src/evidence/evidence-layout";
import { captureSelectionEvidence } from "../../src/evidence/evidence-source";
import { relativeOutputBounds } from "../../src/evidence/geometry";
import { createSnapshotCapture } from "../../src/evidence/image";
import { captureRasterSize } from "../../src/evidence/png";
import {
  assertCapturableIframes,
  type RasterizeElement,
  resolveCaptureBackground,
  shouldCaptureNode,
} from "../../src/evidence/raster";

const toPng = vi.fn<RasterizeElement>();
const { captureOutputSnapshot, captureSelectionSnapshot } = createSnapshotCapture(toPng);

beforeEach(() => {
  toPng.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("image capture", () => {
  test("rejects a capture context unrelated to the selected element", async () => {
    const output = document.createElement("span");
    const context = document.createElement("article");
    document.body.append(output, context);
    const result = await captureSelectionSnapshot({
      selectionId: "selection-1",
      label: "S1",
      output,
      anchor: { kind: "point", x: 0.5, y: 0.5 },
      context,
    });
    expect(result).toMatchObject({
      status: "failed",
      snapshot: { error: expect.stringContaining("ancestor") },
    });
    expect(toPng).not.toHaveBeenCalled();
  });

  test("clips a region to the portion visible in its detail image", () => {
    expect(
      anchorForDetail(
        { kind: "rect", x: 0.125, y: 0.125, width: 0.5, height: 0.5 },
        { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      ),
    ).toEqual({ kind: "rect", x: 0, y: 0, width: 0.75, height: 0.75 });
  });

  test("captures one unmarked raster for the full output root", async () => {
    class LoadedImage extends EventTarget {
      naturalWidth = 640;
      naturalHeight = 320;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    vi.stubGlobal("Image", LoadedImage);
    const context = {
      canvas: Object.assign(document.createElement("canvas"), {
        width: 640,
        height: 320,
      }),
      fillStyle: "",
      fillRect: vi.fn<CanvasRenderingContext2D["fillRect"]>(),
      drawImage: vi.fn<DrawImage>(),
    };
    installCanvasContext(window, context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    });
    toPng.mockResolvedValue("data:image/png;base64,output");
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 1_200 },
      scrollHeight: { configurable: true, value: 600 },
    });

    const result = await captureOutputSnapshot({
      imageId: "image:capture-1",
      output,
    });

    expect(result).toMatchObject({
      metadata: {
        status: "available",
        id: "image:capture-1",
        mediaType: "image/png",
        width: 640,
        height: 320,
        sha256: expect.stringMatching(/^[a-f\d]{64}$/),
      },
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(toPng).toHaveBeenCalledTimes(1);
    expect(toPng.mock.calls[0]?.[0]).toBe(output);
    expect(toPng.mock.calls[0]?.[1]).toMatchObject({
      width: 1_200,
      height: 600,
    });
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  test("creates decoded images and canvases in the output document", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frameRealm(frame);
    class LoadedImage extends EventTarget {
      naturalWidth = 640;
      naturalHeight = 320;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    Object.defineProperty(ownerWindow, "Image", { configurable: true, value: LoadedImage });
    const ownerDigest = vi.fn(window.crypto.subtle.digest.bind(window.crypto.subtle));
    Object.defineProperty(ownerWindow.crypto, "subtle", {
      configurable: true,
      value: { digest: ownerDigest },
    });
    const context = {
      fillStyle: "",
      fillRect: vi.fn<CanvasRenderingContext2D["fillRect"]>(),
      drawImage: vi.fn<DrawImage>(),
    };
    installCanvasContext(ownerWindow, context);
    vi.spyOn(ownerWindow.HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback: BlobCallback) => {
        callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
      },
    );
    const createElement = vi.spyOn(ownerDocument, "createElement");
    toPng.mockResolvedValue("data:image/png;base64,output");
    const output = ownerDocument.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 200 },
    });

    const result = await captureOutputSnapshot({
      imageId: "image:owned",
      output,
    });

    expect(createElement.mock.calls.some(([name]) => name === "canvas")).toBe(true);
    expect(context.drawImage.mock.calls[0]?.[0]).toBeInstanceOf(LoadedImage);
    expect(result.bytes).toBeInstanceOf(ownerWindow.Uint8Array);
    expect(ownerDigest).toHaveBeenCalledOnce();
  });

  test("bounds transient rasters and final evidence layouts", () => {
    const raster = captureRasterSize(12_000, 8_000);
    expect(raster.width).toBeLessThanOrEqual(2_048);
    expect(raster.height).toBeLessThanOrEqual(2_048);
    expect(raster.width * raster.height).toBeLessThanOrEqual(4_000_000);

    const small = evidenceLayout(640, 480, false);
    expect(small).toEqual({
      width: 640,
      height: 480,
      overview: { x: 0, y: 0, width: 640, height: 480 },
    });
    const large = evidenceLayout(6_000, 4_000, true);
    expect(large.detail).toBeDefined();
    expect(large.width).toBeLessThanOrEqual(2_048);
    expect(large.height).toBeLessThanOrEqual(2_048);
    expect(large.width * large.height).toBeLessThanOrEqual(4_000_000);
  });

  test("places the region label outside the selected pixels", () => {
    const source = document.createElement("img");
    Object.defineProperties(source, {
      naturalWidth: { configurable: true, value: 400 },
      naturalHeight: { configurable: true, value: 200 },
    });
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = {
      canvas,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      shadowColor: "",
      shadowBlur: 0,
      font: "",
      textBaseline: "",
      fillRect: vi.fn<CanvasRenderingContext2D["fillRect"]>(),
      drawImage: vi.fn<DrawImage>(),
      save: vi.fn<CanvasRenderingContext2D["save"]>(),
      restore: vi.fn<CanvasRenderingContext2D["restore"]>(),
      strokeRect: vi.fn<CanvasRenderingContext2D["strokeRect"]>(),
      measureText: vi.fn(() => ({ width: 17 })),
      beginPath: vi.fn<CanvasRenderingContext2D["beginPath"]>(),
      roundRect: vi.fn<CanvasRenderingContext2D["roundRect"]>(),
      fill: vi.fn<CanvasRenderingContext2D["fill"]>(),
      fillText: vi.fn<CanvasRenderingContext2D["fillText"]>(),
    };
    installCanvasContext(window, context);

    composeSelectionEvidence({
      ownerDocument: document,
      overview: source,
      detail: null,
      backgroundColor: "#fff",
      anchor: { kind: "rect", x: 0.04, y: 0.12, width: 0.5, height: 0.4 },
      label: "S1",
    });

    const [selectionX, selectionY] = context.strokeRect.mock.calls[0]!;
    const [labelX, labelY, , labelHeight] = context.roundRect.mock.calls[0]!;
    expect(labelX).toBe(selectionX);
    expect(labelY + labelHeight).toBeLessThanOrEqual(selectionY);
  });

  test("derives detail marker bounds from the element actually captured", () => {
    const output = document.createElement("div");
    const detail = document.createElement("div");
    output.appendChild(detail);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 20 },
      scrollTop: { configurable: true, value: 10 },
    });
    output.getBoundingClientRect = () => new DOMRect(100, 50, 300, 160);
    detail.getBoundingClientRect = () => new DOMRect(180, 90, 100, 50);

    expect(relativeOutputBounds(detail, output)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.25,
      height: 0.25,
    });
  });

  test("derives marker bounds in layout pixels when the output is scaled", () => {
    const output = document.createElement("div");
    const detail = document.createElement("div");
    output.appendChild(detail);
    Object.defineProperties(output, {
      offsetWidth: { configurable: true, value: 300 },
      offsetHeight: { configurable: true, value: 160 },
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 20 },
      scrollTop: { configurable: true, value: 10 },
    });
    output.getBoundingClientRect = () => new DOMRect(100, 50, 240, 128);
    detail.getBoundingClientRect = () => new DOMRect(180, 82, 80, 40);

    expect(relativeOutputBounds(detail, output)).toEqual({
      x: 0.3,
      y: 0.25,
      width: 0.25,
      height: 0.25,
    });
  });

  test("captures detail first and keeps the pre-capture target bounds", async () => {
    class LoadedImage extends EventTarget {
      naturalWidth = 640;
      naturalHeight = 480;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    vi.stubGlobal("Image", LoadedImage);
    const output = document.createElement("div");
    const detail = document.createElement("div");
    const scroller = document.createElement("div");
    const leaf = document.createElement("span");
    detail.appendChild(leaf);
    scroller.appendChild(detail);
    output.appendChild(scroller);
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 200 },
    });
    leaf.getBoundingClientRect = () => new DOMRect(160, 85, 20, 16);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 3_000 },
      scrollHeight: { configurable: true, value: 1_500 },
    });
    output.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    detail.getBoundingClientRect = () => new DOMRect(100, 75, 220, 44);
    let resolveDetail!: (value: string) => void;
    const detailCapture = new Promise<string>((resolve) => {
      resolveDetail = resolve;
    });
    toPng
      .mockImplementationOnce(() => detailCapture)
      .mockResolvedValueOnce("data:image/png;base64,overview");

    const capture = captureSelectionEvidence(
      {
        anchor: { kind: "point", x: 0.06, y: 0.06 },
        output,
        detailElement: leaf,
      },
      undefined,
      toPng,
    );

    expect(toPng.mock.calls[0]?.[0]).toBe(detail);
    detail.getBoundingClientRect = () => new DOMRect(900, 600, 600, 300);
    resolveDetail("data:image/png;base64,detail");
    const sources = await capture;

    expect(toPng.mock.calls.map(([element]) => element)).toEqual([detail, output]);
    expect(sources.detail?.bounds).toEqual({
      x: 1 / 30,
      y: 0.05,
      width: 220 / 3_000,
      height: 44 / 1_500,
    });
  });

  test("captures a large output root as visible detail before its full overview", async () => {
    class LoadedImage extends EventTarget {
      naturalWidth = 640;
      naturalHeight = 480;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    vi.stubGlobal("Image", LoadedImage);
    const output = document.createElement("div");
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 3_000 },
      scrollHeight: { configurable: true, value: 1_500 },
      scrollLeft: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 150 },
    });
    output.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    toPng
      .mockResolvedValueOnce("data:image/png;base64,detail")
      .mockResolvedValueOnce("data:image/png;base64,overview");

    const sources = await captureSelectionEvidence(
      {
        anchor: { kind: "point", x: 0.2, y: 0.2 },
        output,
        detailElement: output,
      },
      undefined,
      toPng,
    );

    expect(toPng.mock.calls).toHaveLength(2);
    expect(toPng.mock.calls[0]?.[1]).toMatchObject({ width: 600, height: 400 });
    expect(toPng.mock.calls[1]?.[1]).toMatchObject({ width: 3_000, height: 1_500 });
    expect(sources.detail?.bounds).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 400 / 1_500,
    });
  });

  test("fails explicitly for inaccessible iframes nested in an open shadow root", () => {
    const output = document.createElement("div");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: null });
    shadow.appendChild(iframe);
    output.appendChild(host);

    expect(() => assertCapturableIframes(output)).toThrow(/iframe content/i);
  });

  test("fails explicitly for an inaccessible iframe inside an accessible iframe", () => {
    const output = document.createElement("div");
    const outer = document.createElement("iframe");
    output.appendChild(outer);
    document.body.appendChild(output);
    const inner = outer.contentDocument!.createElement("iframe");
    Object.defineProperty(inner, "contentDocument", { configurable: true, value: null });
    outer.contentDocument!.body.appendChild(inner);

    expect(() => assertCapturableIframes(output)).toThrow(/iframe content/i);
  });

  test("rejects capture when an iframe becomes inaccessible during rasterization", async () => {
    const output = document.createElement("div");
    const iframe = document.createElement("iframe");
    output.appendChild(iframe);
    document.body.appendChild(output);
    expect(iframe.contentDocument?.body).toBeDefined();
    toPng.mockImplementation(async () => {
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        value: null,
      });
      return "data:image/png;base64,incomplete";
    });

    await expect(
      captureOutputSnapshot({
        imageId: "image:iframe-navigation",
        output,
      }),
    ).rejects.toThrow(/iframe content/i);
  });

  test("resolves a transparent shadow output against its host background", () => {
    const host = document.createElement("div");
    host.style.backgroundColor = "rgb(12, 34, 56)";
    const shadow = host.attachShadow({ mode: "open" });
    const output = document.createElement("div");
    shadow.appendChild(output);
    document.body.appendChild(host);

    expect(resolveCaptureBackground(output)).toBe("rgb(12, 34, 56)");
  });

  test("filters Lens UI and reports renderer failures as failed snapshots", async () => {
    const lensUi = document.createElement("div");
    lensUi.setAttribute("data-marimo-lens-ui", "");
    const child = document.createElement("button");
    lensUi.appendChild(child);
    expect(shouldCaptureNode(child)).toBe(false);

    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 8_000, 5_000);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 8_000 },
      scrollHeight: { configurable: true, value: 5_000 },
    });
    toPng.mockRejectedValueOnce(new Error(`${"e".repeat(239)}😀`));
    const result = await captureSelectionSnapshot({
      selectionId: "selection-1",
      label: "S1",
      anchor: { kind: "point", x: 0.5, y: 0.5 },
      output,
    });

    expect(result).toMatchObject({ status: "failed", snapshot: { error: "e".repeat(239) } });
    expect(toPng.mock.calls[0]?.[1]).toMatchObject({
      canvasWidth: expect.any(Number),
      canvasHeight: expect.any(Number),
      pixelRatio: 1,
    });
  });

  test("aborts an in-flight renderer capture", async () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    let resolveCapture!: (dataUrl: string) => void;
    toPng.mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );
    const controller = new AbortController();
    const capture = captureSelectionSnapshot({
      selectionId: "selection-1",
      label: "S1",
      anchor: { kind: "point", x: 0.5, y: 0.5 },
      output,
      signal: controller.signal,
    });
    const rejected = expect(capture).rejects.toMatchObject({ name: "AbortError" });

    controller.abort(new DOMException("Lens closed", "AbortError"));
    resolveCapture("data:image/png;base64,overview");

    await rejected;
  });

  test("propagates an ambient cancellation from a secondary document capture", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow?.self;
    if (!ownerDocument || !ownerWindow) throw new Error("Iframe realm must be available");
    const output = ownerDocument.createElement("div");
    output.getBoundingClientRect = () => new ownerWindow.DOMRect(0, 0, 400, 240);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 240 },
    });
    ownerDocument.body.appendChild(output);
    const cancellation = new DOMException("Parent renderer canceled", "AbortError");
    toPng.mockRejectedValueOnce(cancellation);

    await expect(
      captureSelectionSnapshot({
        selectionId: "selection-1",
        label: "S1",
        anchor: { kind: "point", x: 0.5, y: 0.5 },
        output,
      }),
    ).rejects.toBe(cancellation);
  });
});

type OwnerRealm = Window & typeof globalThis;

interface RasterCanvasContext {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  fillRect: CanvasRenderingContext2D["fillRect"];
  drawImage: DrawImage;
}

type DrawImage = (
  image: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  destinationHeight: number,
) => void;

interface CanvasContextOwner {
  getContext(contextId: "2d"): RasterCanvasContext | null;
}

function installCanvasContext(ownerWindow: OwnerRealm, context: RasterCanvasContext): void {
  const canvasOwner: CanvasContextOwner = ownerWindow.HTMLCanvasElement.prototype;
  vi.spyOn(canvasOwner, "getContext").mockReturnValue(context);
}

function frameRealm(frame: HTMLIFrameElement): OwnerRealm {
  const ownerWindow = frame.contentWindow?.self;
  if (!ownerWindow) throw new Error("Iframe window must be available");
  return ownerWindow;
}
