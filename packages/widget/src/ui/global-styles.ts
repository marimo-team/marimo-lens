const STYLE_ID = "marimo-lens-global-styles";
const STYLE_REGISTRY: unique symbol = Symbol.for("marimo-lens.style-registry.v1");

type StyleRegistry = {
  owners: number;
  element: HTMLStyleElement;
};

declare global {
  interface Document {
    [STYLE_REGISTRY]?: StyleRegistry;
  }
}

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
    if (ownerDocument[STYLE_REGISTRY] === registry) delete ownerDocument[STYLE_REGISTRY];
  };
}

function styleRegistry(ownerDocument: Document): StyleRegistry {
  const existing = ownerDocument[STYLE_REGISTRY];
  if (existing) return existing;

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

function isStyleElement(element: HTMLElement | null): element is HTMLStyleElement {
  if (!element) return false;
  const StyleElementClass = element.ownerDocument.defaultView?.HTMLStyleElement;
  return StyleElementClass
    ? element instanceof StyleElementClass
    : element.localName.toLowerCase() === "style";
}
