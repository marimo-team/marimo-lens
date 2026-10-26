import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vitepress build",
        dependsOn: ["@marimo-lens/python#build"],
        cache: {
          env: ["BASE_PATH"],
        },
      },
    },
  },
});
