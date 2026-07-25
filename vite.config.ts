import { defineConfig } from "vite-plus";

const generated = [
  "dist/**",
  "packages/*/dist/**",
  "packages/marimo-lens/src/marimo_lens/static/**",
];

export default defineConfig({
  fmt: {
    ignorePatterns: generated,
    sortImports: {
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
  },
  lint: {
    categories: {
      correctness: "error",
    },
    env: {
      browser: true,
      builtin: true,
    },
    ignorePatterns: generated,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    plugins: [
      "import",
      "jsx-a11y",
      "oxc",
      "promise",
      "react",
      "react-hooks",
      "react-perf",
      "typescript",
      "unicorn",
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**"],
        rules: {
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
  run: {
    cache: true,
  },
});
