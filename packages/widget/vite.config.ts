import stylexRollup from "@stylexjs/unplugin/rollup";
import stylex from "@stylexjs/unplugin/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // Vitest has no HTTP server to release the Vite adapter's HMR poller.
  plugins: [(mode === "test" ? stylexRollup : stylex)({ devMode: "css-only", useCSSLayers: true })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  pack: {
    css: {
      fileName: "widget.css",
    },
    dts: true,
    entry: ["src/widget.tsx"],
    loader: {
      ".svg": "dataurl",
    },
    plugins: [stylexRollup({ useCSSLayers: true })],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
}));
