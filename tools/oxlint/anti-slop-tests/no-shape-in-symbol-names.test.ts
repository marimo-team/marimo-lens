import { noForbiddenTermInSymbolNamesRule } from "../anti-slop/rules/no-shape-in-symbol-names.ts";
import { ruleTester } from "./rule-tester.ts";

const error = (name: string) => ({
  messageId: "forbiddenSymbolName",
  data: { name },
});

ruleTester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
  valid: [
    {
      code: "const geometry = {}; class Model { #bounds; } const view = <Canvas />;",
      filename: "fixture.tsx",
    },
  ],
  invalid: [
    {
      code: "let shape;",
      errors: [error("shape")],
    },
    {
      code: "let dataSHAPE;",
      errors: [error("dataSHAPE")],
    },
    {
      code: "const payloadShape = input; consume(payloadShape); consume(payloadShape);",
      errors: [error("payloadShape")],
    },
    {
      code: "const payload = { payloadShape: input };",
      errors: [error("payloadShape")],
    },
    {
      code: "consume(payload.payloadShape);",
      errors: [error("payloadShape")],
    },
    {
      code: "class Model { #shape; }",
      errors: [error("shape")],
    },
    {
      code: "const view = <Shape />;",
      filename: "fixture.tsx",
      errors: [error("Shape")],
    },
  ],
});
