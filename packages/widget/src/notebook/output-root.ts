import type { OutputCell } from "@/notebook/types";

import { OUTPUT_ROOT_SELECTOR, resolveOutputRoot } from "@/notebook/output-root-rules";

const LENS_OUTPUT_REGISTRY = Symbol.for("marimo-lens.output-registry.v1");

type LensOutputRegistry = WeakMap<HTMLElement, number>;

export function registerLensHostOutput(host: Element): () => void {
  const root = owningOutputRoot(host);
  if (!root) return () => {};

  const registry = lensOutputRegistry(root.ownerDocument);
  registry.set(root, (registry.get(root) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const owners = registry.get(root) ?? 0;
    if (owners <= 1) registry.delete(root);
    else registry.set(root, owners - 1);
  };
}

export function outputCellFromElement(element: Element | null): OutputCell | null {
  let current: Element | null = element;
  while (current) {
    const cell = outputCellFromRoot(current);
    if (cell) return cell;
    const root = current.getRootNode();
    current = current.parentElement ?? (isShadowRoot(root) ? root.host : null);
  }
  return null;
}

export function outputCellFromEvent(event: Event): OutputCell | null {
  for (const item of event.composedPath()) {
    if (!isElement(item)) continue;
    if (item.closest("[data-marimo-lens-ui]")) return null;
    const cell = outputCellFromRoot(item);
    if (cell) return cell;
  }
  return isElement(event.target) ? outputCellFromElement(event.target) : null;
}

export function getOutputCell(ownerDocument: Document, outputCellId: string): OutputCell | null {
  for (const root of ownerDocument.querySelectorAll(OUTPUT_ROOT_SELECTOR)) {
    const cell = outputCellFromRoot(root);
    if (cell?.id === outputCellId && isVisible(cell.element)) return cell;
  }
  return null;
}

export function listOutputCells(ownerDocument: Document): OutputCell[] {
  return Array.from(ownerDocument.querySelectorAll(OUTPUT_ROOT_SELECTOR))
    .map(outputCellFromRoot)
    .filter((cell): cell is OutputCell => cell !== null && isVisible(cell.element));
}

export function outputCellFromRoot(element: Element): OutputCell | null {
  const resolved = resolveOutputRoot(element);
  if (!resolved || containsLensHost(resolved.root)) return null;
  return { id: resolved.id, element: resolved.element };
}

export function isOutputRoot(element: Element): boolean {
  return element.matches(OUTPUT_ROOT_SELECTOR);
}

export function deepestElementAtPoint(
  ownerDocument: Document,
  x: number,
  y: number,
): Element | null {
  const candidates = ownerDocument.elementsFromPoint(x, y);
  for (const candidate of candidates) {
    if (isLensUi(candidate)) continue;
    const deepest = descendOpenShadowRoots(candidate, x, y);
    if (!isLensUi(deepest)) return deepest;
  }
  return null;
}

export function deepestElementFromEvent(event: Event, output: HTMLElement): Element {
  for (const item of event.composedPath()) {
    if (!isElement(item)) continue;
    if (item.closest("[data-marimo-lens-ui]")) continue;
    if (item === output || output.contains(item) || isInsideShadowHost(item, output)) return item;
  }
  return output;
}

function containsLensHost(root: HTMLElement): boolean {
  const registry: unknown = Reflect.get(root.ownerDocument, LENS_OUTPUT_REGISTRY);
  return registry instanceof WeakMap && registry.has(root);
}

function owningOutputRoot(element: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    const resolved = resolveOutputRoot(current);
    if (resolved) return resolved.root;
    const root = current.getRootNode();
    current = current.parentElement ?? (isShadowRoot(root) ? root.host : null);
  }
  return null;
}

function lensOutputRegistry(ownerDocument: Document): LensOutputRegistry {
  const existing: unknown = Reflect.get(ownerDocument, LENS_OUTPUT_REGISTRY);
  if (existing instanceof WeakMap) return existing as LensOutputRegistry;

  const registry: LensOutputRegistry = new WeakMap();
  Object.defineProperty(ownerDocument, LENS_OUTPUT_REGISTRY, {
    configurable: true,
    value: registry,
  });
  return registry;
}

function descendOpenShadowRoots(element: Element, x: number, y: number): Element {
  let current = element;
  while (current.shadowRoot) {
    const shadow = current.shadowRoot;
    const child = shadow
      .elementsFromPoint(x, y)
      .find((candidate) => candidate.getRootNode() === shadow && !isLensUi(candidate));
    if (!child || child === current) break;
    current = child;
  }
  return current;
}

function isInsideShadowHost(element: Element, output: HTMLElement): boolean {
  let root = element.getRootNode();
  while (isShadowRoot(root)) {
    if (output.contains(root.host)) return true;
    root = root.host.getRootNode();
  }
  return false;
}

function isLensUi(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.matches("[data-marimo-lens-ui]")) return true;
    const root = current.getRootNode();
    current = current.parentElement ?? (isShadowRoot(root) ? root.host : null);
  }
  return false;
}

function isVisible(element: HTMLElement): boolean {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) return false;
  const style = ownerWindow.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
  );
}

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 1;
}

function isShadowRoot(value: Node): value is ShadowRoot {
  return value.nodeType === 11 && "host" in value;
}
