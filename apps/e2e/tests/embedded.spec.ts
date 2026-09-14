import { expect, test } from "@playwright/test";

test("keeps the dock inside a clipped notebook webview while scrolling and resizing", async ({
  page,
}, testInfo) => {
  await page.route("**/embedded-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<style>
        body { margin: 0; }
        #pane { position: relative; width: 800px; height: 500px; overflow: hidden; }
        iframe { position: absolute; top: -6000px; width: 100%; height: 12489px; border: 0; }
      </style><div id="pane"><iframe src="http://127.0.0.1:4817"></iframe></div>`,
    }),
  );
  await page.goto("/embedded-host");
  const notebook = page.frameLocator("iframe");
  const dock = notebook.locator("[data-marimo-lens-dock]");
  await expect(dock).toBeVisible({ timeout: 30_000 });

  const expectDockInPane = async (height: number, gap = 16) => {
    await expect(async () => {
      const bounds = await dock.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThan(0);
      expect(bounds!.y + bounds!.height).toBeCloseTo(height - gap, 0);
    }).toPass({ timeout: 10_000 });
  };

  await expectDockInPane(500);
  await notebook.getByRole("button", { name: "Collapse Lens" }).click();
  await notebook.getByRole("button", { name: "Open Lens", exact: true }).click();

  // VS Code moves the oversized webview and publishes scroll updates to it.
  await page.evaluate(() => {
    const frame = document.querySelector("iframe")!;
    frame.style.top = "-6400px";
    frame.contentWindow!.postMessage({ type: "view-scroll", widgets: [], markupCells: [] }, "*");
  });
  await expectDockInPane(500);

  await page.evaluate(() => {
    document.getElementById("pane")!.style.height = "350px";
    document.getElementById("pane")!.style.width = "390px";
    document.querySelector("iframe")!.contentWindow!.postMessage({ type: "view-scroll" }, "*");
  });
  await expectDockInPane(350, 12);
  await page.screenshot({ path: testInfo.outputPath("embedded-dock.png") });
});
