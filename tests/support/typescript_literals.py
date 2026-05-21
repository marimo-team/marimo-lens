from __future__ import annotations

import json
import subprocess
from pathlib import Path


def exported_string_arrays(
    path: Path, names: tuple[str, ...]
) -> dict[str, tuple[str, ...]]:
    script = """
const fs = require("node:fs");
const ts = require("typescript");

const [path, namesJson] = process.argv.slice(1);
const names = new Set(JSON.parse(namesJson));
const source = ts.createSourceFile(
  path,
  fs.readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const arrays = {};

function visit(node) {
  if (
    ts.isVariableStatement(node) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    for (const declaration of node.declarationList.declarations) {
      const name = declaration.name.getText(source);
      if (!names.has(name)) continue;
      const initializer = unwrapAsConst(declaration.initializer);
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`${name} is not an exported const string array`);
      }
      arrays[name] = initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) throw new Error(`${name} has a non-string element`);
        return element.text;
      });
    }
  }
  ts.forEachChild(node, visit);
}

function unwrapAsConst(node) {
  if (node && ts.isAsExpression(node) && node.type.getText(source) === "const") {
    return node.expression;
  }
  return node;
}

visit(source);
for (const name of names) {
  if (!arrays[name]) throw new Error(`missing exported const array: ${name}`);
}
process.stdout.write(JSON.stringify(arrays));
"""
    result = subprocess.run(
        ["node", "-e", script, str(path), json.dumps(names)],
        check=True,
        capture_output=True,
        text=True,
    )
    return {name: tuple(values) for name, values in json.loads(result.stdout).items()}
