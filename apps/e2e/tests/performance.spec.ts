import { expect, type CDPSession, type Page } from "@playwright/test";

import { runAction, selectOutput, test } from "./support";

declare global {
  interface Window {
    pngUrls: { created: number; active: Set<string> };
  }
}

async function browserMetrics(session: CDPSession) {
  const { metrics } = await session.send("Performance.getMetrics");
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    scriptMs: value("ScriptDuration") * 1000,
    heap: value("JSHeapUsedSize"),
    nodes: value("Nodes"),
    listeners: value("JSEventListeners"),
  };
}

async function streamFrames(page: Page) {
  return page.evaluate(async () => {
    const tick = document.getElementById("stream-tick");
    if (!tick) throw new Error("Streaming output is unavailable");
    const frames: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < 90; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      if (index > 0) frames.push(now - previous);
      previous = now;
      tick.textContent = String(index);
    }
    frames.sort((a, b) => a - b);
    return { p95: frames[Math.floor(frames.length * 0.95)], maximum: frames.at(-1)! };
  });
}

test("a large streaming notebook stays responsive with multiple output annotations", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.getByRole("combobox", { name: "Table rows" }).selectOption({ label: "1000" });
  await expect(page.getByRole("region", { name: "Streaming table" }).locator("tr")).toHaveCount(
    1000,
  );
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  const views = page.getByRole("combobox", { name: "Lens views" });
  await views.selectOption({ label: "Hidden" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toHaveCount(0);
  const baselineStart = await browserMetrics(session);
  const baselineFrames = await streamFrames(page);
  const baselineEnd = await browserMetrics(session);
  await views.selectOption({ label: "Single" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toBeVisible();
  const annotationMs: number[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const started = performance.now();
    await selectOutput(page, index % 2 ? "point" : "region", `S${index}`, `Request ${index}`);
    annotationMs.push(performance.now() - started);
  }
  const report = await runAction(page);
  expect(report.references.selections).toHaveLength(12);
  expect(Object.keys(report.images)).toHaveLength(12);
  const activeStart = await browserMetrics(session);
  const activeFrames = await streamFrames(page);
  const activeEnd = await browserMetrics(session);
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.getByRole("region", { name: "Revenue by month" }).hover();
  const armedStart = await browserMetrics(session);
  const armedFrames = await streamFrames(page);
  const armedEnd = await browserMetrics(session);
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeHidden();
  const unavailableStart = await browserMetrics(session);
  const unavailableFrames = await streamFrames(page);
  const unavailableEnd = await browserMetrics(session);
  await page.getByRole("checkbox", { name: "Show revenue" }).check();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeVisible();
  const measurements = {
    rows: 1000,
    selections: 12,
    frames: 90,
    baseline: { ...baselineFrames, scriptMs: baselineEnd.scriptMs - baselineStart.scriptMs },
    annotated: { ...activeFrames, scriptMs: activeEnd.scriptMs - activeStart.scriptMs },
    armed: { ...armedFrames, scriptMs: armedEnd.scriptMs - armedStart.scriptMs },
    unavailable: {
      ...unavailableFrames,
      scriptMs: unavailableEnd.scriptMs - unavailableStart.scriptMs,
    },
    annotationMs,
    contextMs: report.context_ms,
  };
  await testInfo.attach("streaming-performance", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  // Budget the added Lens work against the same notebook with its view unmounted.
  for (const scenario of [measurements.annotated, measurements.armed, measurements.unavailable]) {
    expect(scenario.scriptMs - measurements.baseline.scriptMs).toBeLessThan(750);
    expect(scenario.p95).toBeLessThan(Math.max(50, baselineFrames.p95 * 2));
    expect(scenario.maximum).toBeLessThan(Math.max(250, baselineFrames.maximum * 2));
  }
  expect(report.context_ms).toBeLessThan(250);
  expect(Math.max(...annotationMs)).toBeLessThan(2500);
  await selectOutput(page, "point", "S13", "Still responsive after streaming");
  expect((await runAction(page)).references.selections).toHaveLength(13);
});

test("preview and annotation churn releases PNG URLs and bounds retained browser resources", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    window.pngUrls = { created: 0, active: new Set() };
    URL.createObjectURL = (object) => {
      const url = create(object);
      if (object instanceof Blob && object.type === "image/png") {
        window.pngUrls.created += 1;
        window.pngUrls.active.add(url);
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.pngUrls.active.delete(url);
      revoke(url);
    };
  });
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  const samples: Awaited<ReturnType<typeof browserMetrics>>[] = [];
  const durations: number[] = [];
  for (let cycle = 1; cycle <= 16; cycle += 1) {
    const started = performance.now();
    await selectOutput(page, "point", `S${cycle}`, `Review cycle ${cycle}`);
    await page.getByRole("button", { name: /^Open selections,/ }).click();
    await page.getByRole("button", { name: `View image for S${cycle}.`, exact: true }).click();
    const preview = page.getByRole("dialog", {
      name: `Selection image for S${cycle}`,
      exact: true,
    });
    await expect
      .poll(() =>
        preview.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await preview.getByRole("button", { name: "Close preview" }).click();
    await page.getByRole("button", { name: `Remove selection S${cycle}`, exact: true }).click();
    await expect(page.getByRole("region", { name: "Selections", exact: true })).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.pngUrls.active.size)).toBe(0);
    durations.push(performance.now() - started);
    if (cycle === 4 || cycle === 10 || cycle === 16) {
      await session.send("HeapProfiler.collectGarbage");
      samples.push(await browserMetrics(session));
    }
  }
  const report = await runAction(page);
  expect(report.references.selections).toEqual([]);
  expect(report.images).toEqual({});
  const created = await page.evaluate(() => window.pngUrls.created);
  expect(created).toBeGreaterThanOrEqual(16);
  await testInfo.attach("annotation-churn", {
    body: JSON.stringify({ samples, durations, pngUrlsCreated: created }, null, 2),
    contentType: "application/json",
  });
  // Compare after warmup and GC so caches and normal startup do not look like leaks.
  expect(samples[2].heap - samples[0].heap).toBeLessThan(8 * 1024 * 1024);
  expect(samples[2].nodes - samples[0].nodes).toBeLessThan(500);
  expect(samples[2].listeners - samples[0].listeners).toBeLessThan(100);
  const first = durations.slice(2, 6).reduce((sum, duration) => sum + duration, 0) / 4;
  const last = durations.slice(-4).reduce((sum, duration) => sum + duration, 0) / 4;
  expect(last).toBeLessThan(first * 1.75 + 250);
});
