import { defineConfig } from "vite-plus";

import { antiSlopIgnorePatterns, antiSlopRules } from "./tools/oxlint/anti-slop/preset.ts";

const generated = [
  "dist/**",
  "packages/*/dist/**",
  "packages/marimo-lens/src/marimo_lens/static/**",
];

const ignored = [...generated, ...antiSlopIgnorePatterns];

// Widget folders, lowest first. A folder imports only the folders before it.
const widgetLayers = [
  "styles",
  "anywidget",
  "notebook",
  "ui",
  "selection",
  "context",
  "history",
  "transient",
  "dock",
  "app",
];

type LayerRule = { files: string[]; rules: Record<string, ["error", unknown]> };

const widgetLayerRules = widgetLayers.slice(0, -1).map((layer, index): LayerRule => ({
  files: [`packages/widget/src/${layer}/**`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: widgetLayers.slice(index + 1).map((higher) => ({
          group: [`@/${higher}/*`, `../${higher}/*`, `../../${higher}/*`],
          message: `${layer}/ sits below ${higher}/ in the widget layers.`,
        })),
      },
    ],
  },
}));

export default defineConfig({
  fmt: {
    ignorePatterns: ignored,
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
    ignorePatterns: ignored,
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
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
      "react-perf",
      "typescript",
      "unicorn",
    ],
    rules: {
      ...antiSlopRules,
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      ...widgetLayerRules,
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
