import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./js", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["js/**/*.test.ts"],
  },
});
