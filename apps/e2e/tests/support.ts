import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Selection = {
  id: string;
  label: string;
  note: string;
  target: { kind: string; cellIds: string[]; domSelector?: string };
  cells: { id: string; status: string }[];
  domHint?: { tag: string; text?: string; path?: string };
  anchor: { kind: string; x: number; y: number; width?: number; height?: number };
  snapshot: { status: string };
};

type Report = {
  action: string;
  error: { code: string; revision: number | null } | null;
  context_ms: number;
  references: { revision: number; selections: Selection[] };
  images: Record<string, { bytes: number; signature: string }>;
  text: string;
};

export const test = base.extend<{ browserErrors: string[]; notebook: void }>({
  notebook: [
    async ({ page, colorScheme, browserErrors }, use, testInfo) => {
      let url = "/?theme=system";
      if (testInfo.project.name === "editor") {
        // Edit mode shares a kernel per file. Each test gets its own notebook.
        const notebook = testInfo.outputPath("notebook.py");
        await mkdir(dirname(notebook), { recursive: true });
        await copyFile(
          fileURLToPath(new URL("../fixtures/notebook.py", import.meta.url)),
          notebook,
        );
        url += `&file=${encodeURIComponent(notebook)}`;
      }
      await page.goto(url);
      await expect(page.locator("body")).toHaveAttribute("data-theme", colorScheme ?? "light");
      // A fresh kernel can still be importing notebook packages after the page loads.
      await expect(page.getByRole("region", { name: "Revenue by month" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole("button", { name: "Select a target", exact: true }),
      ).toBeVisible();
      expect(browserErrors).toEqual([]);
      await use();
    },
    { auto: true },
  ],
  browserErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const copilotStartup: string[] = [];
      const backgroundImageFailures: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const url = message.location().url;
        // Windows can exhaust a socket buffer loading marimo's decorative texture.
        // Keep the diagnostic without failing Lens coverage on this optional image.
        if (
          text === "Failed to load resource: net::ERR_NO_BUFFER_SPACE" &&
          url.startsWith(`${new URL(page.url()).origin}/assets/`) &&
          /\/assets\/noise-[\w-]+\.png$/.test(url)
        ) {
          backgroundImageFailures.push(`${url}: ${text}`);
          return;
        }
        // marimo 0.24 eagerly initializes its disabled Copilot client in each editor.
        if (
          testInfo.project.name === "editor" &&
          text.split(/\r?\n/, 1)[0] ===
            'Language server initialization failed RPCError: Request "initialize" timed out after 30000ms' &&
          /\/assets\/cells-[\w-]+\.js$/.test(message.location().url)
        ) {
          copilotStartup.push(text);
          return;
        }
        errors.push(text);
      });
      await use(errors);
      if (backgroundImageFailures.length > 0) {
        await testInfo.attach("marimo-background-image-failures", {
          body: JSON.stringify(backgroundImageFailures, null, 2),
          contentType: "application/json",
        });
      }
      if (copilotStartup.length > 0) {
        await testInfo.attach("marimo-disabled-copilot-startup", {
          body: JSON.stringify(copilotStartup, null, 2),
          contentType: "application/json",
        });
      }
      expect(errors, "browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

export async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

export async function runAction(page: Page, action = "Inspect context"): Promise<Report> {
  const output = page.locator('[aria-label="Agent result"]');
  const previous = (await output.count()) > 0 ? await output.textContent() : null;
  const select = page.getByRole("combobox", { name: "Agent action" });
  const changed =
    (await select.evaluate((element: HTMLSelectElement) => element.selectedOptions[0]?.label)) !==
    action;
  await select.selectOption({ label: action });
  // A new action reruns the result cell and clears the stale report. Clicking
  // during that rerun can race the layout shift and drop the click.
  if (previous !== null && changed) await expect(output).toHaveCount(0);
  await page
    .getByRole("button", { name: "Run agent action", exact: true })
    .click({ noWaitAfter: true });
  await expect(output).toBeVisible();
  await expect(output).not.toHaveText(previous ?? "");
  const report: Report = JSON.parse((await output.textContent()) ?? "");
  expect(report.action).toBe(action);
  return report;
}

export async function selectOutput(
  page: Page,
  kind: "point" | "region",
  label: string,
  note: string,
  target = page.getByRole("region", { name: "Revenue by month" }),
) {
  await target.scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "Select a target", exact: true })
    .click({ noWaitAfter: true });
  await expect(
    page.getByRole("button", { name: "Cancel selection mode", exact: true }),
  ).toBeVisible();
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Selection target is not rendered");
  const x = bounds.x + bounds.width * 0.3;
  const y = bounds.y + bounds.height * 0.35;
  if (kind === "point") {
    await page.mouse.click(x, y);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + bounds.width * 0.35, y + bounds.height * 0.45, { steps: 8 });
    await page.mouse.up();
  }
  const editor = page.getByRole("dialog", { name: new RegExp(`Add note for ${label}`) });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("textbox", { name: `Note for selection ${label}` })).toBeFocused();
  await page.getByRole("textbox", { name: `Note for selection ${label}` }).fill(note);
  // This button saves through the widget transport. The dialog and enabled dock
  // below acknowledge completion without Playwright's unrelated navigation barrier.
  await editor.getByRole("button", { name: "Done", exact: true }).click({ noWaitAfter: true });
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toBeEnabled();
}

export async function expectInsideViewport(page: Page, surface: Locator) {
  await expect(surface).toBeVisible();
  await expect(async () => {
    const bounds = await surface.boundingBox();
    const viewport = page.viewportSize();
    if (!bounds || !viewport) throw new Error("Surface or viewport is unavailable");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  }).toPass({ timeout: 10_000 });
}
