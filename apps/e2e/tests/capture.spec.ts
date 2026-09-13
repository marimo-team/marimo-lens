import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

declare global {
  interface Window {
    captureProbe: typeof import("@marimo-lens/image-capture");
  }
}

let captureScript: string;
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(import.meta.resolve("@marimo-lens/image-capture"))],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "captureProbe",
  });
  captureScript = bundle.outputFiles[0]!.text;
});

async function openCaptureFixture(page: Page, body: string) {
  await page.route(
    "**/capture-fixture",
    (route) => route.fulfill({ contentType: "text/html", body }),
    { times: 1 },
  );
  await page.goto("/capture-fixture");
  await page.addScriptTag({ content: captureScript });
}

test("captures styled and aligned SVG marks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openCaptureFixture(
    page,
    '<style>body{margin:0}.mark{fill:rgb(255,122,87)}</style><main style="width:200px;height:200px;display:grid;align-content:center"><svg width="200" height="80"><g><rect class="mark" x="10" y="10" width="80" height="60"/></g></svg></main>',
  );
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
    const image = await createImageBitmap(
      new Blob([new Uint8Array(result.snapshot.bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    image.close();
    return [...context.getImageData(30, 90, 1, 1).data];
  });
  expect(pixel).toEqual([255, 122, 87, 255]);
  expect(errors).toEqual([]);
});

test("small DOM captures include their card and preserve point and region coordinates", async ({
  page,
}, testInfo) => {
  for (const scenario of ["point", "rect", "footer", "explicit", "scaled"] as const) {
    await openCaptureFixture(
      page,
      `<style>body{margin:0}article{width:360px;height:180px;position:relative;background:rgb(230,245,210)}h2{margin:0;padding:12px;font:20px sans-serif}strong{position:absolute;left:100px;top:90px;width:44px;height:16px;font:14px monospace}</style><article><h2>Athletes in the selected sport</h2><strong>11538</strong><div data-marimo-lens-ui style="position:absolute;inset:0;background:magenta"></div></article>`,
    );
    const kind = scenario === "rect" ? "rect" : "point";
    if (scenario === "scaled") {
      await page.locator("article").evaluate((element) => {
        element.style.transform = "scale(0.6)";
        element.style.transformOrigin = "top left";
      });
    }
    if (scenario === "footer") {
      await page.locator("article").evaluate((element) => {
        element.style.cssText = "position:relative;left:70px;top:30px;width:1440px;height:80px";
        element.querySelector("strong")!.style.top = "30px";
      });
    }
    if (scenario === "explicit") {
      await page.locator("article").evaluate((article) => {
        const context = document.createElement("section");
        context.id = "capture-context";
        context.style.cssText = "width:500px;height:300px;background:rgb(230,245,210)";
        article.replaceWith(context);
        context.append(article);
      });
    }
    const result = await page.evaluate(
      async ({ kind, scenario }) => {
        const output = document.querySelector("strong")!;
        const anchor =
          kind === "point"
            ? { kind: "point" as const, x: 0.5, y: 0.5 }
            : { kind: "rect" as const, x: 0, y: 0, width: 1, height: 1 };
        const result = await window.captureProbe.captureSelectionSnapshot({
          selectionId: kind,
          label: "S1",
          output,
          detailElement: output,
          anchor,
          context: scenario === "explicit" ? document.getElementById("capture-context")! : "auto",
        });
        if (result.status === "failed") throw new Error(result.snapshot.error);
        const image = await createImageBitmap(
          new Blob([new Uint8Array(result.snapshot.bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        image.close();
        const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
        const marker =
          kind === "rect" ? pixel(100, 98) : pixel(122, scenario === "footer" ? 58 : 98);
        const heading = [
          ...context.getImageData(12, scenario === "footer" ? 32 : 12, 300, 30).data,
        ].filter((value, index) => index % 4 !== 3 && value < 80).length;
        return {
          width: canvas.width,
          height: canvas.height,
          marker,
          heading,
          background: pixel(10, scenario === "footer" ? 90 : 170),
          png: canvas.toDataURL(),
        };
      },
      { kind, scenario },
    );
    expect(result.width).toBe(scenario === "footer" ? 320 : scenario === "explicit" ? 500 : 360);
    expect(result.height).toBe(scenario === "footer" ? 120 : scenario === "explicit" ? 300 : 180);
    expect(result.marker).toEqual([8, 128, 234, 255]);
    expect(result.background).toEqual([230, 245, 210, 255]);
    expect(result.heading).toBeGreaterThan(100);
    await testInfo.attach(`context-${scenario}`, {
      body: Buffer.from(result.png.split(",")[1]!, "base64"),
      contentType: "image/png",
    });
  }
});

test("context captures retain every corner of a large selected rectangle", async ({ page }) => {
  await openCaptureFixture(
    page,
    `<style>body{margin:0}main{position:relative;width:1100px;height:760px;background:#eee}article{position:absolute;left:40px;top:40px;width:900px;height:600px;background:white}i{position:absolute;width:12px;height:12px}</style><main><article><i style="left:8px;top:8px;background:rgb(255,0,0)"></i><i style="right:8px;top:8px;background:rgb(0,255,0)"></i><i style="left:8px;bottom:8px;background:rgb(0,0,255)"></i><i style="right:8px;bottom:8px;background:rgb(255,0,255)"></i></article></main>`,
  );
  const evidence = await page.evaluate(async () => {
    const result = await window.captureProbe.captureSelectionSnapshot({
      selectionId: "rectangle",
      label: "S1",
      output: document.querySelector("article")!,
      context: document.querySelector("main")!,
      anchor: { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
    });
    if (result.status === "failed") throw new Error(result.snapshot.error);
    const image = await createImageBitmap(
      new Blob([new Uint8Array(result.snapshot.bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return {
      width: canvas.width,
      height: canvas.height,
      corners: ["255,0,0", "0,255,0", "0,0,255", "255,0,255"].map((color) => colors.has(color)),
    };
  });
  expect(evidence.width).toBeGreaterThanOrEqual(900);
  expect(evidence.height).toBeGreaterThanOrEqual(600);
  expect(evidence.corners).toEqual([true, true, true, true]);
});

test("scrolled output evidence includes the whole output and the current viewport", async ({
  page,
}) => {
  await openCaptureFixture(
    page,
    `<style>body{margin:0}main{width:400px;height:200px;overflow:auto}</style>
    <main><div style="width:2000px;position:relative"><div style="height:1000px;background:rgb(220,40,60)"></div><div style="height:2000px;background:rgb(30,180,90)"></div><div style="height:1000px;background:rgb(40,90,220)"></div><div style="position:absolute;left:400px;top:1000px;width:400px;height:2000px;background:rgb(240,150,30)"></div></div></main>`,
  );
  const bands = await page.evaluate(async () => {
    const output = document.querySelector("main")!;
    output.scrollTop = 1500;
    output.scrollLeft = 400;
    const result = await window.captureProbe.captureOutputSnapshot({
      imageId: "image:scroll",
      output,
    });
    const image = await createImageBitmap(
      new Blob([new Uint8Array(result.bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    image.close();
    const column = context.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data;
    const colors = ["220,40,60", "30,180,90", "40,90,220", "240,150,30"];
    const runs: string[] = [];
    for (let i = 0; i < column.length; i += 4) {
      const color = `${column[i]},${column[i + 1]},${column[i + 2]}`;
      if (colors.includes(color) && runs.at(-1) !== color) runs.push(color);
    }
    return runs;
  });
  expect(bands).toEqual(["220,40,60", "30,180,90", "40,90,220", "240,150,30"]);
});
