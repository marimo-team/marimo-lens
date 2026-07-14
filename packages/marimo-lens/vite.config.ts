import anywidgetBundle from "@marimo-lens/anywidget-bundle/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    anywidgetBundle({
      app: "@marimo-lens/widget",
      outDir: "src/marimo_lens/static",
    }),
  ],
});
