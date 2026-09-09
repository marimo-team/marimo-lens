const CONFIGURED_OUTPUT_CELL_ATTRIBUTE = "data-marimo-lens-output-cell-id";
export const OUTPUT_ROOT_SELECTOR = [
  `[${CONFIGURED_OUTPUT_CELL_ATTRIBUTE}]`,
  '[id^="output-"]',
  "marimo-island[data-cell-id]",
].join(",");

const OUTPUT_ID_PREFIX = "output-";

export type ResolvedOutputRoot = {
  id: string;
  root: HTMLElement;
  element: HTMLElement;
};

export function resolveOutputRoot(element: Element): ResolvedOutputRoot | null {
  if (!isHTMLElement(element)) return null;

  const configuredId = cellIdFromAttribute(element, CONFIGURED_OUTPUT_CELL_ATTRIBUTE);
  if (configuredId) return { id: configuredId, root: element, element };

  if (element.id.startsWith(OUTPUT_ID_PREFIX)) {
    const id = element.id.slice(OUTPUT_ID_PREFIX.length);
    return id ? { id, root: element, element } : null;
  }

  if (element.matches("marimo-island[data-cell-id]")) {
    const id = cellIdFromAttribute(element, "data-cell-id");
    return id ? { id, root: element, element: islandOutputElement(element) } : null;
  }

  return null;
}

function islandOutputElement(island: HTMLElement): HTMLElement {
  const output = island.querySelector(".output, marimo-cell-output");
  if (!isHTMLElement(output)) return island;

  const children = Array.from(output.children).filter(isHTMLElement);
  if (children.length !== 1) return output;

  const child = children[0];
  const ownerWindow = child?.ownerDocument.defaultView;
  return child && ownerWindow?.getComputedStyle(child).display !== "contents" ? child : output;
}

function cellIdFromAttribute(element: Element, attribute: string): string | null {
  const value = element.getAttribute(attribute)?.trim();
  return value ? value : null;
}

function isHTMLElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow !== null && element instanceof ownerWindow.HTMLElement;
}
