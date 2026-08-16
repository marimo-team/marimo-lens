import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
  "BlockStatement",
  "BreakStatement",
  "ClassDeclaration",
  "ContinueStatement",
  "DebuggerStatement",
  "DoWhileStatement",
  "EmptyStatement",
  "ExpressionStatement",
  "ExportAllDeclaration",
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionDeclaration",
  "IfStatement",
  "ImportDeclaration",
  "LabeledStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "SwitchStatement",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSInterfaceDeclaration",
  "TSModuleDeclaration",
  "TSNamespaceExportDeclaration",
  "TSTypeAliasDeclaration",
  "ThrowStatement",
  "TryStatement",
  "VariableDeclaration",
  "WhileStatement",
  "WithStatement",
]);

function isNode(value: unknown): value is ESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function previousSibling(sourceCode: SourceCode, node: ESTree.Node): ESTree.Node | null {
  if (node.parent === null) return null;
  const parentNode = node.parent;
  const parent = parentNode as unknown as Readonly<Record<string, unknown>>;
  for (const key of sourceCode.visitorKeys[parentNode.type] ?? []) {
    const children = parent[key];
    if (!Array.isArray(children)) continue;
    const index = children.indexOf(node);
    if (index === -1) continue;
    for (let siblingIndex = index - 1; siblingIndex >= 0; siblingIndex -= 1) {
      const sibling = children[siblingIndex];
      if (isNode(sibling)) return sibling;
    }
    return null;
  }
  return null;
}

function exportedDeclarationOwner(
  node: ESTree.Node,
): ESTree.ExportDefaultDeclaration | ESTree.ExportNamedDeclaration | null {
  const parent = node.parent;
  if (parent === null) return null;
  if (
    (parent.type === "ExportDefaultDeclaration" || parent.type === "ExportNamedDeclaration") &&
    parent.declaration === node
  ) {
    return parent;
  }
  return null;
}

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
  let current: ESTree.Node = node;
  while (true) {
    const sibling = previousSibling(sourceCode, current);
    if (
      sourceCode
        .getCommentsBefore(current)
        .some(
          (comment) =>
            comment.end <= node.start &&
            /\bSAFETY\s*:/u.test(comment.value) &&
            sibling?.loc.end.line !== comment.loc.start.line,
        )
    ) {
      return true;
    }
    const exportOwner = exportedDeclarationOwner(current);
    if (exportOwner !== null) {
      current = exportOwner;
      continue;
    }
    if (commentOwnerKinds.has(current.type) || current.parent.type === "Program") return false;
    current = current.parent;
  }
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  createOnce(context) {
    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node) || hasSafetyComment(context.sourceCode, node)) return;
      context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
