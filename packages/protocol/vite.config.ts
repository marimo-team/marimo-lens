import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
