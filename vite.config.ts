import { defineConfig } from "vite-plus";

const generated = [
  "dist/**",
  "packages/*/dist/**",
  "packages/marimo-lens/src/marimo_lens/static/**",
];

const installedAgentAssets = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  "tools/oxlint/anti-slop/**",
];

const ignored = [...generated, ...installedAgentAssets];

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
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
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
  test: {
    include: ["tools/oxlint/anti-slop-tests/**/*.test.ts"],
  },
  run: {
    cache: true,
  },
});
