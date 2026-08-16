import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);
const functionInvocationMethods = new Set(["apply", "call"]);
const functionBindingMethods = new Set(["bind"]);
const vitestModules = new Set(["vite-plus/test", "vitest"]);

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function frameworkExport(source: string, name: string | null): boolean {
  return (
    (name === "vi" && vitestModules.has(source)) ||
    (source === "@jest/globals" && name === "jest")
  );
}

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

type StableConstBinding =
  | { kind: "expression"; expression: ESTree.Expression }
  | { kind: "property"; object: ESTree.Expression; property: string };

function bindingPropertyName(property: ESTree.BindingProperty): string | null {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" && typeof property.key.value === "string"
    ? property.key.value
    : null;
}

function stableConstBinding(variable: Variable): StableConstBinding | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  if (definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator") {
    return null;
  }
  const declarator = definition.node;
  if (
    declarator.init === null ||
    declarator.parent.type !== "VariableDeclaration" ||
    declarator.parent.kind !== "const" ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return null;
  }
  if (declarator.id.type === "Identifier") {
    return declarator.id.name === variable.name
      ? { kind: "expression", expression: declarator.init }
      : null;
  }
  if (declarator.id.type !== "ObjectPattern") return null;

  for (const property of declarator.id.properties) {
    if (
      property.type !== "Property" ||
      property.value.type !== "Identifier" ||
      property.value.name !== variable.name
    ) {
      continue;
    }
    const name = bindingPropertyName(property);
    return name === null
      ? null
      : { kind: "property", object: declarator.init, property: name };
  }
  return null;
}

function frameworkImport(variable: Variable): boolean {
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    return frameworkExport(definition.parent.source.value, importedName(definition.node));
  });
}

function namespaceImportSource(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables: ReadonlySet<Variable>,
): string | null {
  const identifier = unwrapExpression(expression);
  if (identifier.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || visitedVariables.has(variable)) return null;

  for (const definition of variable.defs) {
    if (
      definition.type === "ImportBinding" &&
      definition.node.type === "ImportNamespaceSpecifier" &&
      definition.parent?.type === "ImportDeclaration"
    ) {
      return definition.parent.source.value;
    }
  }

  const binding = stableConstBinding(variable);
  if (binding === null || binding.kind !== "expression") return null;
  const nextVisited = new Set(visitedVariables);
  nextVisited.add(variable);
  return namespaceImportSource(sourceCode, binding.expression, nextVisited);
}

function memberName(expression: ESTree.Expression): string | null {
  if (expression.type !== "MemberExpression") return null;
  const property = expression.property;
  if (expression.computed) {
    return property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : null;
  }
  return property.type === "Identifier" ? property.name : null;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "MemberExpression") {
    const name = memberName(unwrapped);
    if (name === null) return false;
    const source = namespaceImportSource(sourceCode, unwrapped.object, visitedVariables);
    return source !== null && frameworkExport(source, name);
  }
  if (unwrapped.type !== "Identifier") return false;
  if (
    (unwrapped.name === "vi" || unwrapped.name === "jest") &&
    sourceCode.isGlobalReference(unwrapped)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || variable.defs.length === 0) {
    return unwrapped.name === "vi" || unwrapped.name === "jest";
  }
  if (frameworkImport(variable)) return true;
  if (visitedVariables.has(variable)) return false;

  const binding = stableConstBinding(variable);
  if (binding === null) return false;
  const nextVisited = new Set(visitedVariables);
  nextVisited.add(variable);
  if (binding.kind === "expression") {
    return isTestFrameworkObject(sourceCode, binding.expression, nextVisited);
  }
  const source = namespaceImportSource(sourceCode, binding.object, nextVisited);
  return source !== null && frameworkExport(source, binding.property);
}

function isModuleMockMethodValue(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "MemberExpression") {
    const method = memberName(unwrapped);
    return (
      method !== null &&
      moduleMockMethods.has(method) &&
      isTestFrameworkObject(sourceCode, unwrapped.object, visitedVariables)
    );
  }
  if (unwrapped.type === "CallExpression") {
    return (
      unwrapped.callee.type !== "Super" &&
      unwrapped.callee.type !== "V8IntrinsicExpression" &&
      isModuleMockMethodAdapter(
        sourceCode,
        unwrapped.callee,
        functionBindingMethods,
        visitedVariables,
      )
    );
  }
  if (unwrapped.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) return false;
  const binding = stableConstBinding(variable);
  if (binding === null) return false;
  const nextVisited = new Set(visitedVariables);
  nextVisited.add(variable);
  if (binding.kind === "expression") {
    return isModuleMockMethodValue(sourceCode, binding.expression, nextVisited);
  }
  return (
    moduleMockMethods.has(binding.property) &&
    isTestFrameworkObject(sourceCode, binding.object, nextVisited)
  );
}

function isModuleMockMethodAdapter(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  adapters: ReadonlySet<string>,
  visitedVariables: ReadonlySet<Variable>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "MemberExpression") return false;
  const adapter = memberName(unwrapped);
  return (
    adapter !== null &&
    adapters.has(adapter) &&
    isModuleMockMethodValue(sourceCode, unwrapped.object, visitedVariables)
  );
}

function isModuleMockInvocation(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  return (
    isModuleMockMethodValue(sourceCode, callee) ||
    isModuleMockMethodAdapter(sourceCode, callee, functionInvocationMethods, new Set())
  );
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isModuleMockInvocation(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
