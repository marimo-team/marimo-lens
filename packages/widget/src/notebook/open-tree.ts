export function containsOpenTree(root: Element, node: Element): boolean {
  let current: Element | null = node;
  while (current) {
    if (root === current || root.contains(current)) return true;
    const currentRoot = current.getRootNode();
    current = isShadowRoot(currentRoot) ? currentRoot.host : null;
  }
  return false;
}

function isShadowRoot(value: Node): value is ShadowRoot {
  return value.nodeType === 11 && "host" in value;
}
