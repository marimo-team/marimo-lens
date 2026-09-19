import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4817",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "light",
      testMatch: [
        "lens.spec.ts",
        "capture.spec.ts",
        "robustness.spec.ts",
        "performance.spec.ts",
        "sessions.spec.ts",
        "embedded.spec.ts",
        "style.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "dark",
      testMatch: "lens.spec.ts",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    {
      name: "narrow-dark",
      testMatch: "lens.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
      },
    },
    {
      name: "narrow-light",
      testMatch: "lens.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        colorScheme: "light",
      },
    },
    {
      name: "editor",
      testMatch: ["editor.spec.ts", "robustness.spec.ts"],
      use: { ...devices["Desktop Chrome"], colorScheme: "light", baseURL: "http://127.0.0.1:4820" },
    },
  ],
  webServer: [
    {
      command:
        "uv run --locked marimo run apps/e2e/fixtures/notebook.py --host 127.0.0.1 --port 4817 --headless --no-token --session-ttl 1",
      cwd: "../..",
      url: "http://127.0.0.1:4817",
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 5_000 },
    },
    {
      command:
        "uv run --locked marimo edit . --host 127.0.0.1 --port 4820 --headless --no-token --session-ttl 1",
      env: { _MARIMO_CONFIG_OVERLOAD_RUNTIME_AUTO_INSTANTIATE: "true" },
      cwd: ".",
      url: "http://127.0.0.1:4820",
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 5_000 },
    },
  ],
});
