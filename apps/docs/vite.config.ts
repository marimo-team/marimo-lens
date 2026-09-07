import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vitepress build",
        dependsOn: ["@marimo-lens/python#build"],
        env: ["BASE_PATH"],
      },
    },
  },
});
