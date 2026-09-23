import type { OutputCell } from "@/notebook/types";

import { containsOpenTree } from "@/notebook/open-tree";
import { OUTPUT_ROOT_SELECTOR, resolveOutputRoot } from "@/notebook/output-root-rules";

const LENS_OUTPUT_REGISTRY: unique symbol = Symbol.for("marimo-lens.output-registry.v2");

type LensOutputRegistry = Map<HTMLElement, number>;

declare global {
  interface Document {
    [LENS_OUTPUT_REGISTRY]?: LensOutputRegistry;
  }
}

export function registerLensHostOutput(host: Element): () => void {
  const root = owningOutputRoot(host);
  if (!root) return () => {};

  const ownerDocument = root.ownerDocument;
  const registry = lensOutputRegistry(ownerDocument);
  registry.set(root, (registry.get(root) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const owners = registry.get(root) ?? 0;
    if (owners <= 1) registry.delete(root);
    else registry.set(root, owners - 1);
    if (registry.size === 0 && ownerDocument[LENS_OUTPUT_REGISTRY] === registry) {
      delete ownerDocument[LENS_OUTPUT_REGISTRY];
    }
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
  const canonical = ownerDocument.getElementById(`output-${outputCellId}`);
  if (canonical) {
    const cell = outputCellFromRoot(canonical);
    if (cell?.id === outputCellId) return isVisible(cell.element) ? cell : null;
  }
  const cellContainer = ownerDocument.getElementById(`cell-${outputCellId}`);
  const scope =
    cellContainer?.getAttribute("data-cell-id") === outputCellId ? cellContainer : ownerDocument;
  for (const root of outputRoots(scope)) {
    const resolved = resolveOutputRoot(root);
    if (resolved?.id !== outputCellId) continue;
    const cell = outputCellFromRoot(root);
    if (cell && isVisible(cell.element)) return cell;
  }
  return null;
}

// marimo renders no output root for a cell without output. Its cell container
// stands in as the cell's notebook surface until an output root appears. Like
// getOutputCell, the check reads the canonical root and the container's open
// tree. Only document-tree containers qualify, so lookup by ID finds every
// picked cell.
export function outputlessCellFromRoot(element: Element): OutputCell | null {
  const id = element.getAttribute("data-cell-id");
  if (!id || element.id !== `cell-${id}` || !isHTMLElement(element)) return null;
  const ownerDocument = element.ownerDocument;
  if (element.getRootNode() !== ownerDocument) return null;
  if (ownerDocument.getElementById(`output-${id}`)) return null;
  return outputRoots(element).next().done ? { id, element } : null;
}

export function getOutputlessCell(ownerDocument: Document, cellId: string): OutputCell | null {
  const element = ownerDocument.getElementById(`cell-${cellId}`);
  const cell = element ? outputlessCellFromRoot(element) : null;
  return cell && isVisible(cell.element) ? cell : null;
}

/** Skips cells with a listed output root, wherever that root renders. */
export function listOutputlessCells(
  ownerDocument: Document,
  outputs: readonly OutputCell[],
): OutputCell[] {
  const listed = new Set(outputs.map(({ id }) => id));
  const cells: OutputCell[] = [];
  for (const element of ownerDocument.querySelectorAll('[id^="cell-"][data-cell-id]')) {
    if (listed.has(element.getAttribute("data-cell-id")!)) continue;
    const cell = outputlessCellFromRoot(element);
    if (cell) cells.push(cell);
  }
  return cells;
}

export function listOutputCells(ownerDocument: Document): OutputCell[] {
  return listOutputRoots(ownerDocument).filter((cell) => isVisible(cell.element));
}

export function listOutputRoots(ownerDocument: Document): OutputCell[] {
  const cells: OutputCell[] = [];
  for (const root of outputRoots(ownerDocument)) {
    const cell = outputCellFromRoot(root);
    if (cell) cells.push(cell);
  }
  return cells;
}

function* outputRoots(root: ParentNode): Generator<Element> {
  const candidates = new Set(root.querySelectorAll(OUTPUT_ROOT_SELECTOR));
  for (const element of root.querySelectorAll("*")) {
    if (candidates.has(element)) yield element;
    if (element.shadowRoot) yield* outputRoots(element.shadowRoot);
  }
}

export function outputCellFromRoot(element: Element): OutputCell | null {
  const resolved = resolveOutputRoot(element);
  if (!resolved || containsLensHost(resolved.root)) return null;
  return { id: resolved.id, element: resolved.element };
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

export function containsLensHost(root: HTMLElement): boolean {
  const registry = root.ownerDocument[LENS_OUTPUT_REGISTRY];
  if (!registry) return false;
  for (const output of registry.keys()) {
    if (containsOpenTree(root, output)) return true;
  }
  return false;
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
  const existing = ownerDocument[LENS_OUTPUT_REGISTRY];
  if (existing) return existing;

  const registry: LensOutputRegistry = new Map();
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

function isHTMLElement(element: Element): element is HTMLElement {
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow !== null && element instanceof ownerWindow.HTMLElement;
}

function isElement(value: EventTarget | null): value is Element {
  return value !== null && "nodeType" in value && value.nodeType === 1;
}

function isShadowRoot(value: Node): value is ShadowRoot {
  return value.nodeType === 11 && "host" in value;
}
