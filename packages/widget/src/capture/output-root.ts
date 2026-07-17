import type { OutputCell } from "@/types";

const OUTPUT_ID_PREFIX = "output-";
const LENS_OUTPUT_REGISTRY = Symbol.for("marimo-lens.output-registry.v1");

type LensOutputRegistry = WeakMap<HTMLElement, number>;

export function registerLensHostOutput(host: Element): () => void {
  const output = owningOutputRoot(host);
  if (!output) return () => {};

  const registry = lensOutputRegistry(output.ownerDocument);
  registry.set(output, (registry.get(output) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const owners = registry.get(output) ?? 0;
    if (owners <= 1) registry.delete(output);
    else registry.set(output, owners - 1);
  };
}

export function outputCellFromElement(element: Element | null): OutputCell | null {
  let current: Element | null = element;
  while (current) {
    const cell = outputCellFromRoot(current);
    if (cell) return cell;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return null;
}

export function outputCellFromEvent(event: Event): OutputCell | null {
  for (const item of event.composedPath()) {
    if (!(item instanceof Element)) continue;
    if (item.closest("[data-marimo-lens-ui]")) return null;
    const cell = outputCellFromRoot(item);
    if (cell) return cell;
  }
  return event.target instanceof Element ? outputCellFromElement(event.target) : null;
}

export function getOutputCell(outputCellId: string): OutputCell | null {
  const element = document.getElementById(`${OUTPUT_ID_PREFIX}${outputCellId}`);
  if (!(element instanceof HTMLElement)) return null;
  const cell = outputCellFromRoot(element);
  return cell && isVisible(cell.element) ? cell : null;
}

export function listOutputCells(): OutputCell[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[id^="${OUTPUT_ID_PREFIX}"]`))
    .map(outputCellFromRoot)
    .filter((cell): cell is OutputCell => cell !== null && isVisible(cell.element));
}

export function deepestElementAtPoint(x: number, y: number): Element | null {
  const candidates = document.elementsFromPoint(x, y);
  for (const candidate of candidates) {
    if (isLensUi(candidate)) continue;
    const deepest = descendOpenShadowRoots(candidate, x, y);
    if (!isLensUi(deepest)) return deepest;
  }
  return null;
}

export function deepestElementFromEvent(event: Event, output: HTMLElement): Element {
  for (const item of event.composedPath()) {
    if (!(item instanceof Element)) continue;
    if (item.closest("[data-marimo-lens-ui]")) continue;
    if (item === output || output.contains(item) || isInsideShadowHost(item, output)) return item;
  }
  return output;
}

function outputCellFromRoot(element: Element): OutputCell | null {
  if (!(element instanceof HTMLElement) || !element.id.startsWith(OUTPUT_ID_PREFIX)) return null;
  if (containsLensHost(element)) return null;
  const id = element.id.slice(OUTPUT_ID_PREFIX.length);
  return id.length > 0 ? { id, element } : null;
}

function containsLensHost(output: HTMLElement): boolean {
  const registry: unknown = Reflect.get(output.ownerDocument, LENS_OUTPUT_REGISTRY);
  return registry instanceof WeakMap && registry.has(output);
}

function owningOutputRoot(element: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLElement && current.id.startsWith(OUTPUT_ID_PREFIX)) return current;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
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
  while (root instanceof ShadowRoot) {
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
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
  );
}
