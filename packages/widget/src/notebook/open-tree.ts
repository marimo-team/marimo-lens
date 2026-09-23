export function containsOpenTree(root: Node, node: Node): boolean {
  let current: Node | null = node;
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

export function composedClosest(node: Element, selector: string): Element | null {
  let current: Element | null = node;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root = current.getRootNode();
    current = isShadowRoot(root) ? root.host : null;
  }
  return null;
}
