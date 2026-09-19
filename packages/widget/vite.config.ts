import stylex from "@stylexjs/unplugin/rollup";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [stylex({ devMode: "css-only", useCSSLayers: true })],
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
    plugins: [stylex({ useCSSLayers: true })],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
