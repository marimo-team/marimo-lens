import { toPng } from "html-to-image";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  assertCapturableIframes,
  captureSelectionSnapshot,
  captureEvidenceSources,
  captureRasterSize,
  detailCaptureElement,
  evidenceLayout,
  relativeElementBounds,
  shouldCaptureNode,
} from "@/capture/image";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

beforeEach(() => {
  vi.mocked(toPng).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selection snapshot capture", () => {
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

  test("captures the clicked child before a scrolled ancestor resets its position", () => {
    const output = document.createElement("div");
    const scroller = document.createElement("div");
    const row = document.createElement("div");
    const leaf = document.createElement("span");
    row.appendChild(leaf);
    scroller.appendChild(row);
    output.appendChild(scroller);
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 200 },
    });
    leaf.getBoundingClientRect = () => new DOMRect(20, 30, 20, 16);
    row.getBoundingClientRect = () => new DOMRect(10, 20, 220, 44);

    expect(detailCaptureElement(leaf, output)).toBe(row);
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

    expect(relativeElementBounds(detail, output)).toEqual({
      x: 0.25,
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
    detail.style.position = "absolute";
    output.appendChild(detail);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 3_000 },
      scrollHeight: { configurable: true, value: 1_500 },
    });
    output.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    detail.getBoundingClientRect = () => new DOMRect(100, 75, 300, 150);
    let resolveDetail!: (value: string) => void;
    const detailCapture = new Promise<string>((resolve) => {
      resolveDetail = resolve;
    });
    vi.mocked(toPng)
      .mockImplementationOnce(() => detailCapture)
      .mockResolvedValueOnce("data:image/png;base64,overview");

    const capture = captureEvidenceSources(
      {
        selectionId: "selection-1",
        label: "S1",
        anchor: { kind: "point", x: 0.2, y: 0.2 },
        output,
        detailElement: detail,
      },
      "#fff",
    );

    expect(vi.mocked(toPng).mock.calls[0]?.[0]).toBe(detail);
    expect(vi.mocked(toPng).mock.calls[0]?.[1]?.style).toMatchObject({
      position: "relative",
      inset: "auto",
      top: "0",
      left: "0",
      right: "auto",
      bottom: "auto",
      transform: "translate(0px, 0px)",
    });
    detail.getBoundingClientRect = () => new DOMRect(900, 600, 600, 300);
    resolveDetail("data:image/png;base64,detail");
    const sources = await capture;

    expect(vi.mocked(toPng).mock.calls.map(([element]) => element)).toEqual([detail, output]);
    expect(sources.detail?.bounds).toEqual({ x: 1 / 30, y: 0.05, width: 0.1, height: 0.1 });
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
    vi.mocked(toPng)
      .mockResolvedValueOnce("data:image/png;base64,detail")
      .mockResolvedValueOnce("data:image/png;base64,overview");

    const sources = await captureEvidenceSources(
      {
        selectionId: "selection-1",
        label: "S1",
        anchor: { kind: "point", x: 0.2, y: 0.2 },
        output,
        detailElement: output,
      },
      "#fff",
    );

    expect(vi.mocked(toPng).mock.calls).toHaveLength(2);
    expect(vi.mocked(toPng).mock.calls[0]?.[1]).toMatchObject({ width: 600, height: 400 });
    expect(vi.mocked(toPng).mock.calls[0]?.[1]?.style).toMatchObject({
      width: "3000px",
      height: "1500px",
      overflow: "visible",
      transform: "translate(-300px, -150px)",
      transformOrigin: "top left",
    });
    expect(vi.mocked(toPng).mock.calls[1]?.[1]).toMatchObject({ width: 3_000, height: 1_500 });
    expect(sources.detail?.bounds).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 400 / 1_500,
    });
    expect(
      evidenceLayout(
        sources.overview.naturalWidth,
        sources.overview.naturalHeight,
        sources.detail !== null,
      ).detail,
    ).toBeDefined();
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

  test("filters Lens UI and reports renderer failures as failed snapshots", async () => {
    const lensUi = document.createElement("div");
    lensUi.setAttribute("data-marimo-lens-ui", "");
    const child = document.createElement("span");
    lensUi.appendChild(child);
    expect(shouldCaptureNode(child)).toBe(false);

    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 8_000, 5_000);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 8_000 },
      scrollHeight: { configurable: true, value: 5_000 },
    });
    vi.mocked(toPng).mockRejectedValueOnce(new Error(`${"e".repeat(239)}😀`));
    const result = await captureSelectionSnapshot({
      selectionId: "selection-1",
      label: "S1",
      anchor: { kind: "point", x: 0.5, y: 0.5 },
      output,
    });

    expect(result).toMatchObject({ status: "failed", snapshot: { error: "e".repeat(239) } });
    expect(vi.mocked(toPng).mock.calls[0]?.[1]).toMatchObject({
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
    vi.mocked(toPng).mockReturnValue(
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
});
