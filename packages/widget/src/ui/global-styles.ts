const STYLE_ID = "marimo-lens-global-styles";
const STYLE_REGISTRY = Symbol.for("marimo-lens.style-registry.v1");

type StyleRegistry = {
  owners: number;
  element: HTMLStyleElement;
};

export function acquireLensGlobalStyles(ownerDocument: Document, css: string): () => void {
  const registry = styleRegistry(ownerDocument);
  if (!registry.element.isConnected) {
    registry.element.setAttribute("data-marimo-lens-ui", "true");
    ownerDocument.head.appendChild(registry.element);
  }
  registry.element.textContent = css;
  registry.owners += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    registry.owners = Math.max(0, registry.owners - 1);
    if (registry.owners > 0) return;
    registry.element.remove();
    if (Reflect.get(ownerDocument, STYLE_REGISTRY) === registry) {
      Reflect.deleteProperty(ownerDocument, STYLE_REGISTRY);
    }
  };
}

function styleRegistry(ownerDocument: Document): StyleRegistry {
  const existing: unknown = Reflect.get(ownerDocument, STYLE_REGISTRY);
  if (isStyleRegistry(existing)) return existing;

  const existingElement = ownerDocument.getElementById(STYLE_ID);
  const element = isStyleElement(existingElement)
    ? existingElement
    : Object.assign(ownerDocument.createElement("style"), { id: STYLE_ID });
  const registry = { owners: 0, element };
  Object.defineProperty(ownerDocument, STYLE_REGISTRY, {
    configurable: true,
    value: registry,
  });
  return registry;
}

function isStyleRegistry(value: unknown): value is StyleRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    "owners" in value &&
    "element" in value &&
    isStyleElement(value.element)
  );
}

function isStyleElement(element: unknown): element is HTMLStyleElement {
  if (
    typeof element !== "object" ||
    element === null ||
    !("nodeType" in element) ||
    element.nodeType !== 1
  ) {
    return false;
  }
  const candidate = element as Element;
  const StyleElementClass = candidate.ownerDocument.defaultView?.HTMLStyleElement;
  return StyleElementClass
    ? candidate instanceof StyleElementClass
    : candidate.localName.toLowerCase() === "style";
}
