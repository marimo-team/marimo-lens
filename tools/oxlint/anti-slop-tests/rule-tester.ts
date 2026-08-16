import { RuleTester } from "oxlint/plugins-dev";
import { describe, test } from "vite-plus/test";

RuleTester.describe = describe;
RuleTester.it = test;

export const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { lang: "ts" },
  },
});
