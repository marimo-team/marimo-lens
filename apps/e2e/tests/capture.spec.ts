import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

declare global {
  interface Window {
    captureProbe: typeof import("@marimo-lens/image-capture");
  }
}

test("captures styled and aligned SVG marks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const bundle = await build({
    entryPoints: [fileURLToPath(import.meta.resolve("@marimo-lens/image-capture"))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "captureProbe",
  });
  await page.route("**/capture-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>body{margin:0}.mark{fill:rgb(255,122,87)}</style><main style="width:200px;height:200px;display:grid;align-content:center"><svg width="200" height="80"><g><rect class="mark" x="10" y="10" width="80" height="60"/></g></svg></main>',
    }),
  );
  await page.goto("/capture-fixture");
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const pixel = await page.evaluate(async () => {
    const output = document.querySelector("main")!;
    const result = await window.captureProbe.captureSelectionSnapshot({
      selectionId: "svg-selection",
      label: "S1",
      output,
      detailElement: output,
      anchor: { kind: "point", x: 0.9, y: 0.9 },
    });
    if (result.status === "failed") throw new Error(result.snapshot.error);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(result.snapshot.bytes)], { type: "image/png" }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable");
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(30, 90, 1, 1).data);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  expect(pixel).toEqual([255, 122, 87, 255]);
  expect(errors).toEqual([]);
});
