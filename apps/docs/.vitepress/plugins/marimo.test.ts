import type {
  MarimoCellOptions,
  MarimoPageCompiler,
  MarimoPageRequest,
} from "@marimo-team/mdx-marimo/remark";

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vite-plus/test";

import { marimoVitePress } from "./marimo";

describe("marimoVitePress", () => {
  it("compiles one shared page and replaces marimo fences with cells", async () => {
    const requests: MarimoPageRequest[] = [];
    const plugin = marimoVitePress({
      cwd: "/project",
      compile: compiler((request) => requests.push(request)),
    });
    const source = [
      "# Live output",
      "",
      "```marimo-config",
      'dependencies = ["numpy"]',
      "```",
      "",
      "```python marimo output=false",
      "import marimo as mo",
      "```",
      "",
      "```python marimo",
      'slider = mo.ui.slider(1, 10, label="Rows")',
      "slider",
      "```",
      "",
      "```python",
      'print("ordinary")',
      "```",
    ].join("\n");

    const result = await transform(plugin, source, "/project/docs/page.md");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      filename: "docs/page.md",
      identity: "docs/page.md",
      metadata: { pyproject: 'dependencies = ["numpy"]' },
      cells: [
        {
          index: 0,
          source: "import marimo as mo",
          options: { render: { output: false } },
        },
        {
          index: 1,
          source: 'slider = mo.ui.slider(1, 10, label="Rows")\nslider',
        },
      ],
    });
    expect(result).not.toContain("marimo-config");
    expect(result).not.toContain("python marimo");
    expect(result).toContain('```python\nprint("ordinary")\n```');

    const payloads = Array.from(result.matchAll(/encoded-payload="([^"]+)"/g));
    expect(payloads).toHaveLength(1);
    expect(decodePayload(payloads[0]![1])).toMatchObject({
      protocolVersion: 1,
      app: { id: "marimo-test", runtimeCellCount: 2 },
      cell: { index: 1 },
    });
  });

  it("reports invalid options with the source line", async () => {
    const warnings: string[] = [];
    const plugin = marimoVitePress({
      cwd: "/project",
      compile: compiler(),
    });

    await transform(
      plugin,
      "Intro\n\n```python marimo typo=true\nvalue = 1\n```",
      "/project/docs/page.md",
      warnings,
    );

    expect(warnings).toEqual(["docs/page.md:3: Unknown marimo option: typo"]);
  });
});

function compiler(inspect: (request: MarimoPageRequest) => void = () => {}): MarimoPageCompiler {
  return (request) => {
    inspect(request);
    return {
      protocolVersion: 1,
      app: {
        id: "marimo-test",
        runtimeCellCount: request.cells.length,
        assets: { links: [], moduleScripts: [] },
      },
      cells: request.cells.map((cell) => ({
        index: cell.index,
        html: cell.options.render?.output === false ? "" : `<p>cell ${cell.index}</p>`,
        options: cell.options as MarimoCellOptions,
      })),
      diagnostics: [],
    };
  };
}

async function transform(
  plugin: ReturnType<typeof marimoVitePress>,
  source: string,
  id: string,
  warnings: string[] = [],
): Promise<string> {
  const result = await plugin.transform.call(
    {
      warn(message: string) {
        warnings.push(message);
      },
    },
    source,
    id,
  );
  if (!result) {
    throw new Error("Expected marimo plugin to transform the page");
  }
  return result.code;
}

function decodePayload(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}
