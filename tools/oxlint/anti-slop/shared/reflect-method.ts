import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

const functionInvocationMethods = new Set(["apply", "call"]);
const functionBindingMethods = new Set(["bind"]);

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

function isGlobalThis(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables: ReadonlySet<Variable>,
): boolean {
  const identifier = unwrapExpression(expression);
  if (identifier.type !== "Identifier") return false;
  if (identifier.name === "globalThis" && sourceCode.isGlobalReference(identifier)) return true;
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) return identifier.name === "globalThis";
  if (visitedVariables.has(variable)) return false;

  const binding = stableConstBinding(variable);
  if (binding === null || binding.kind !== "expression") return false;
  const nextVisited = new Set(visitedVariables);
  nextVisited.add(variable);
  return isGlobalThis(sourceCode, binding.expression, nextVisited);
}

function isGlobalReflect(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables: ReadonlySet<Variable>,
): boolean {
  const identifier = unwrapExpression(expression);
  if (identifier.type === "MemberExpression") {
    return (
      memberName(identifier) === "Reflect" &&
      isGlobalThis(sourceCode, identifier.object, visitedVariables)
    );
  }
  if (identifier.type !== "Identifier") return false;
  if (identifier.name === "Reflect" && sourceCode.isGlobalReference(identifier)) return true;
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) return identifier.name === "Reflect";
  if (visitedVariables.has(variable)) return false;

  const binding = stableConstBinding(variable);
  if (binding === null) return false;
  const nextVisited = new Set(visitedVariables);
  nextVisited.add(variable);
  if (binding.kind === "expression") {
    return isGlobalReflect(sourceCode, binding.expression, nextVisited);
  }
  return (
    binding.property === "Reflect" &&
    isGlobalThis(sourceCode, binding.object, nextVisited)
  );
}

function isGlobalReflectMethodValue(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  methodName: string,
  visitedVariables: ReadonlySet<Variable>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "MemberExpression") {
    return (
      memberName(unwrapped) === methodName &&
      isGlobalReflect(sourceCode, unwrapped.object, visitedVariables)
    );
  }
  if (unwrapped.type === "CallExpression") {
    return (
      unwrapped.callee.type !== "Super" &&
      unwrapped.callee.type !== "V8IntrinsicExpression" &&
      isGlobalReflectMethodAdapter(
        sourceCode,
        unwrapped.callee,
        methodName,
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
    return isGlobalReflectMethodValue(sourceCode, binding.expression, methodName, nextVisited);
  }
  return (
    binding.property === methodName &&
    isGlobalReflect(sourceCode, binding.object, nextVisited)
  );
}

function isGlobalReflectMethodAdapter(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  methodName: string,
  adapters: ReadonlySet<string>,
  visitedVariables: ReadonlySet<Variable>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "MemberExpression") return false;
  const adapter = memberName(unwrapped);
  return (
    adapter !== null &&
    adapters.has(adapter) &&
    isGlobalReflectMethodValue(
      sourceCode,
      unwrapped.object,
      methodName,
      visitedVariables,
    )
  );
}

/** Reports whether a call target names one method on the global Reflect object. */
export function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  return (
    isGlobalReflectMethodValue(sourceCode, callee, methodName, new Set()) ||
    isGlobalReflectMethodAdapter(
      sourceCode,
      callee,
      methodName,
      functionInvocationMethods,
      new Set(),
    )
  );
}
