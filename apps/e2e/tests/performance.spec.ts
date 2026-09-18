import { expect, type CDPSession, type Page } from "@playwright/test";

import { runAction, selectOutput, test } from "./support";

// DOM snapshots run inside the ScriptDuration interval and scale with table size.
// Screenshot recording also competes with the frame and resource measurements.
test.use({ trace: { mode: "retain-on-failure", snapshots: false, screenshots: false } });

type AnnotationLatency = {
  armMs: number | null;
  selectionMs: number | null;
  noteMs: number | null;
};

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

async function observeAnnotationLatency(page: Page, label: string) {
  return page.evaluateHandle((label) => {
    const root = document.querySelector("[data-marimo-lens-portal]")?.shadowRoot;
    const output = document.getElementById("revenue-chart")?.closest('[id^="output-"]');
    if (!root || !output) throw new Error("Annotation surfaces are unavailable");
    const started: AnnotationLatency = { armMs: null, selectionMs: null, noteMs: null };
    const latency: AnnotationLatency = { ...started };
    const complete = (phase: keyof AnnotationLatency) => {
      const start = started[phase];
      if (start !== null && latency[phase] === null) latency[phase] = performance.now() - start;
    };
    const noteDialog = () => root.querySelector(`dialog[aria-label^="Add note for ${label},"]`);
    const ready = () => {
      if (root.querySelector('button[aria-label="Cancel selection mode"]')) complete("armMs");
      const active = root.activeElement;
      if (
        active instanceof HTMLTextAreaElement &&
        noteDialog()?.contains(active) &&
        !active.disabled
      )
        complete("selectionMs");
      const select = root.querySelector('button[aria-label="Select a target"]');
      if (!root.querySelector("dialog") && select instanceof HTMLButtonElement && !select.disabled)
        complete("noteMs");
    };
    const click = (event: Event) => {
      const button = event
        .composedPath()
        .find((item): item is HTMLButtonElement => item instanceof HTMLButtonElement);
      if (button?.getAttribute("aria-label") === "Select a target") started.armMs = event.timeStamp;
      if (button?.textContent?.trim() === "Done" && noteDialog()?.contains(button))
        started.noteMs = event.timeStamp;
    };
    const release = (event: PointerEvent) => {
      if (event.composedPath().includes(output)) started.selectionMs = event.timeStamp;
    };
    // Native event timestamps and DOM readiness exclude driver round trips and polling delays.
    const observer = new MutationObserver(ready);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "disabled", "open"],
    });
    root.addEventListener("click", click, true);
    root.addEventListener("focusin", ready);
    document.addEventListener("pointerup", release, true);
    return {
      stop: () => {
        ready();
        observer.disconnect();
        root.removeEventListener("click", click, true);
        root.removeEventListener("focusin", ready);
        document.removeEventListener("pointerup", release, true);
        return latency;
      },
    };
  }, label);
}

async function measureStreamingModes(page: Page, session: CDPSession) {
  const sample = async () => {
    const before = await browserMetrics(session);
    const frames = await streamFrames(page);
    const after = await browserMetrics(session);
    return { ...frames, scriptMs: after.scriptMs - before.scriptMs };
  };
  const annotated = await sample();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.getByRole("region", { name: "Revenue by month" }).hover();
  const armed = await sample();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeHidden();
  const unavailable = await sample();
  await page.getByRole("checkbox", { name: "Show revenue" }).check();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeVisible();
  return { annotated, armed, unavailable };
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
  const annotationLatency: AnnotationLatency[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const probe = await observeAnnotationLatency(page, `S${index}`);
    try {
      await selectOutput(page, index % 2 ? "point" : "region", `S${index}`, `Request ${index}`);
    } finally {
      try {
        annotationLatency.push(await probe.evaluate((probe) => probe.stop()));
      } finally {
        await probe.dispose();
      }
    }
  }
  const report = await runAction(page);
  expect(report.references.selections).toHaveLength(12);
  expect(Object.keys(report.images)).toHaveLength(12);
  const table = page.getByRole("region", { name: "Streaming table" }).locator("tr");
  await page.getByRole("combobox", { name: "Table rows" }).selectOption({ label: "0" });
  await expect(table).toHaveCount(0);
  const small = await measureStreamingModes(page, session);
  await page.getByRole("combobox", { name: "Table rows" }).selectOption({ label: "1000" });
  await expect(table).toHaveCount(1000);
  const large = await measureStreamingModes(page, session);
  const measurements = {
    rows: 1000,
    selections: 12,
    frames: 90,
    baseline: { ...baselineFrames, scriptMs: baselineEnd.scriptMs - baselineStart.scriptMs },
    small,
    large,
    annotationLatency,
    contextMs: report.context_ms,
  };
  await testInfo.attach("streaming-performance", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  // Compare matching interaction states on the same runner to isolate output-size scaling.
  for (const mode of ["annotated", "armed", "unavailable"] as const) {
    expect(large[mode].scriptMs - small[mode].scriptMs).toBeLessThan(750);
    for (const scenario of [small[mode], large[mode]]) {
      expect(scenario.p95).toBeLessThan(Math.max(50, baselineFrames.p95 * 2));
      expect(scenario.maximum).toBeLessThan(Math.max(250, baselineFrames.maximum * 2));
    }
  }
  expect(report.context_ms).toBeLessThan(250);
  for (const latency of annotationLatency) {
    if (latency.armMs === null || latency.selectionMs === null || latency.noteMs === null) {
      throw new Error(`Annotation did not reach each ready state: ${JSON.stringify(latency)}`);
    }
    for (const duration of Object.values(latency)) expect(duration).toBeGreaterThanOrEqual(0);
    expect(latency.armMs + latency.selectionMs + latency.noteMs).toBeLessThan(2500);
  }
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

test("large authored scopes preserve parent picking, child evidence, and responsive outlines", async ({
  page,
  context,
}, testInfo) => {
  await page.evaluate(() => {
    const scope = document.createElement("main");
    scope.id = "scoped-cards";
    scope.dataset.marimoLensScope = "article";
    scope.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding:16px";
    scope.innerHTML = Array.from(
      { length: 500 },
      (_, i) =>
        `<article id="scoped-card-${i}" style="padding:16px;border:1px solid #999"><h3>Card ${i}</h3><p><em>Focus ${i}</em> ${"<span>Detail</span> ".repeat(20)}</p></article>`,
    ).join("");
    document.body.append(scope);
  });
  const target = page.locator("#scoped-card-0 em");
  await target.scrollIntoViewIfNeeded();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  // Measure discovery before image capture; GC excludes unrelated detached nodes.
  await session.send("HeapProfiler.collectGarbage");
  const before = await browserMetrics(session);
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await target.hover();
  await expect(page.locator("[data-marimo-lens-target-label]")).toContainText("Card 0");
  await session.send("HeapProfiler.collectGarbage");
  const after = await browserMetrics(session);
  const nodeDelta = after.nodes - before.nodes;
  await testInfo.attach("scoped-picking-performance", {
    body: JSON.stringify({
      cards: 500,
      scriptMs: after.scriptMs - before.scriptMs,
      nodeDelta,
    }),
    contentType: "application/json",
  });
  expect(nodeDelta).toBeLessThan(500);
  await target.click();
  const dialog = page.getByRole("dialog", { name: /Add note for S1/ });
  await dialog.getByRole("textbox").fill("Keep this phrase in its card");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const report = await runAction(page);
  expect(report.references.selections).toMatchObject([
    {
      target: { kind: "dom", domSelector: "#scoped-card-0", cellIds: [] },
      domHint: { tag: "em", text: "Focus 0", path: "p > em" },
    },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await target.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await target.hover();
  const label = page.locator("[data-marimo-lens-target-label]");
  await expect(label).toContainText("Card 0");
  expect(
    await label.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      );
    }),
  ).toBe(true);
  await testInfo.attach("scoped-picking-narrow", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
});
