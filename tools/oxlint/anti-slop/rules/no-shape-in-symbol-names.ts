import { defineRule } from "@oxlint/plugins";
import type { ESTree, Variable } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

function identifierKey(node: ESTree.Node): string {
  return `${node.start}:${node.end}`;
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const lexicalIdentifiers = new Set<string>();
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    const registerVariable = (variable: Variable) => {
      for (const identifier of variable.identifiers) {
        lexicalIdentifiers.add(identifierKey(identifier));
      }
      for (const reference of variable.references) {
        lexicalIdentifiers.add(identifierKey(reference.identifier));
      }
      const declaration = variable.identifiers[0] ?? variable.defs[0]?.name;
      if (declaration !== undefined) reportForbiddenSymbolName(declaration);
    };

    return {
      Program() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const variable of scope.variables) registerVariable(variable);
        }
      },
      Identifier(node) {
        if (!lexicalIdentifiers.has(identifierKey(node))) reportForbiddenSymbolName(node);
      },
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});
