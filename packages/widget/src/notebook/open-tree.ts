export function containsOpenTree(root: Node, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (root === current || root.contains(current)) return true;
    const currentRoot = current.getRootNode();
    current = isShadowRoot(currentRoot) ? currentRoot.host : null;
  }
  return false;
}

/**
 * Yield the elements below `root` in tree order without entering shadow roots.
 * A TreeWalker visits a large document several times faster than
 * `querySelectorAll("*")` or a recursive `children` loop.
 */
export function* descendantElements(root: Node): Generator<Element> {
  // SAFETY: a node without an owner document is a document itself.
  const ownerDocument = root.ownerDocument ?? (root as Document);
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // SAFETY: SHOW_ELEMENT makes the walker visit elements only.
    yield node as Element;
  }
}

/** Return whether an element below `root`, in any open shadow tree, satisfies `test`. */
export function someOpenTreeElement(root: Node, test: (element: Element) => boolean): boolean {
  for (const element of descendantElements(root)) {
    if (test(element)) return true;
    if (element.shadowRoot && someOpenTreeElement(element.shadowRoot, test)) return true;
  }
  return false;
}

export function isShadowRoot(value: Node): value is ShadowRoot {
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

/** Return the parent element, or the host when `element` is a shadow root's child. */
export function composedParent(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (isShadowRoot(root) ? root.host : null);
}

export function isElement(value: EventTarget | null): value is Element {
  return value !== null && "nodeType" in value && value.nodeType === 1;
}
