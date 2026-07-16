import anywidgetBundle from "anywidget-bundle";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../widget/src", import.meta.url)),
    },
  },
  plugins: [
    anywidgetBundle({
      app: "@marimo-lens/widget",
      outDir: "src/marimo_lens/static",
    }),
  ],
});
