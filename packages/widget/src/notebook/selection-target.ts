import type { SelectionTarget, TargetSelector } from "@marimo-lens/protocol";

import { parseSelectionTarget } from "@marimo-lens/protocol";

import { indexDocumentIds } from "@/notebook/document-ids";
import {
  containsLensHost,
  getOutputCell,
  listOutputRoots,
  outputCellFromRoot,
} from "@/notebook/output-root";
import { notebookSources } from "@/notebook/projection-sources";

// Authored targets and published projection sources belong to each document,
// including when one default Lens model is shared by several views.
const REGION_SELECTOR =
  "[data-marimo-lens-target], [data-marimo-lens-inputs], " +
  ":has(> [hidden][data-marimo-lens-cell-id])";
export const DECLARED_TARGET_SELECTOR = `${REGION_SELECTOR}, [data-marimo-lens-cell-id]`;
export const TARGET_SCOPE = "[data-marimo-lens-scope]";

const DOCUMENT_POSITION_FOLLOWING = 4;
const DOCUMENT_ID: unique symbol = Symbol.for("marimo-lens.document-id.v1");
const TARGET_IDS: unique symbol = Symbol.for("marimo-lens.target-ids.v1");

declare global {
  interface Document {
    [DOCUMENT_ID]?: string;
    [TARGET_IDS]?: WeakMap<HTMLElement, string>;
  }
}

export type TargetSurface = {
  key: string;
  target: SelectionTarget;
  element: HTMLElement;
};

export function targetFromEvent(event: Event, selector: TargetSelector): TargetSurface | null {
  if (event.composedPath().some((item) => isElement(item) && isLensUi(item))) return null;
  return bestTarget(event.composedPath().filter(isElement), selector);
}

export function targetFromElement(
  element: Element | null,
  selector: TargetSelector,
): TargetSurface | null {
  const elements: Element[] = [];
  let current = element;
  while (current) {
    if (isLensUi(current)) return null;
    elements.push(current);
    current = parentInOpenTree(current);
  }
  return bestTarget(elements, selector);
}

export function getTargetSurface(
  ownerDocument: Document,
  target: SelectionTarget,
  selector: TargetSelector,
): TargetSurface | null {
  if (!targetBelongsToDocument(target, ownerDocument)) return null;
  if (target.kind === "notebook") {
    const output = getOutputCell(ownerDocument, target.cellIds[0]!);
    return output ? surface(target, output.element) : null;
  }
  const element = queryTarget(ownerDocument, target.domSelector);
  if (!element) return null;
  const current = configuredDomTarget(element, selector) ?? domTarget(scopedDomRoot(element));
  return current?.element === element && current.key === surface(target, element)?.key
    ? current
    : null;
}

export function targetBelongsToDocument(target: SelectionTarget, ownerDocument: Document): boolean {
  return (
    target.documentId === documentIdentity(ownerDocument) &&
    target.documentPath === documentPath(ownerDocument)
  );
}

export function listTargetSurfaces(
  ownerDocument: Document,
  selector: TargetSelector,
): TargetSurface[] {
  const strongest = new Map<HTMLElement, { priority: number; surface: TargetSurface }>();
  let ids: ReadonlyMap<string, Element | null> | undefined;
  const configured = new Set(queryTargets(ownerDocument, DECLARED_TARGET_SELECTOR));
  if (selector) queryTargets(ownerDocument, selector).forEach((element) => configured.add(element));
  for (const element of configured) {
    const candidate = domTarget(element, (ids ??= indexDocumentIds(ownerDocument)));
    if (candidate)
      strongest.set(element, {
        priority: matchesSelector(element, REGION_SELECTOR) ? 3 : 2,
        surface: candidate,
      });
  }
  const scopedRoots = new Set<HTMLElement>();
  const positions = new Map<Element, ScopedPosition | null>();
  for (const scope of ownerDocument.querySelectorAll(TARGET_SCOPE)) {
    const grouping = scopeSelector(scope);
    const groups = new Set(
      grouping
        ? [...scope.querySelectorAll("*")].filter(
            (node) => isHTMLElement(node) && matchesSelector(node, grouping),
          )
        : [],
    );
    for (const group of groups) {
      const root = scopedDomRoot(group, positions);
      if (root) scopedRoots.add(root);
    }
    const walker = ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) =>
        isElement(node) &&
        (isLensUi(node) ||
          outputCellFromRoot(node) ||
          matchesSelector(node, DECLARED_TARGET_SELECTOR) ||
          groups.has(node))
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let node: Node | null = scope; node; node = walker.nextNode()) {
      if (!isElement(node)) continue;
      const root = scopedDomRoot(node, positions);
      if (root) scopedRoots.add(root);
    }
  }
  for (const root of scopedRoots) {
    if (strongest.has(root)) continue;
    const candidate = domTarget(root, (ids ??= indexDocumentIds(ownerDocument)));
    if (candidate) strongest.set(root, { priority: 0, surface: candidate });
  }
  for (const output of listOutputRoots(ownerDocument)) {
    if ((strongest.get(output.element)?.priority ?? -1) >= 1) continue;
    const candidate = notebookTarget(output.element);
    if (candidate) strongest.set(output.element, { priority: 1, surface: candidate });
  }

  return [...strongest.values()]
    .filter(({ priority, surface }) => {
      for (
        let parent = parentInOpenTree(surface.element);
        parent;
        parent = parentInOpenTree(parent)
      ) {
        const ancestor = isHTMLElement(parent) ? strongest.get(parent) : undefined;
        if (ancestor && ancestor.priority > priority) return false;
      }
      return true;
    })
    .map(({ surface }) => surface)
    .sort((left, right) => documentOrder(left.element, right.element));
}

function parentInOpenTree(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (isShadowRoot(root) ? root.host : null);
}

export function validateTargetSelector(ownerDocument: Document, selector: TargetSelector): void {
  if (!selector) return;
  try {
    ownerDocument.querySelector(selector);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Lens dom_selector is invalid: ${message}`);
  }
}

function bestTarget(elements: Element[], selector: TargetSelector): TargetSurface | null {
  if (elements.some((element) => element.getAttribute("aria-busy") === "true")) return null;
  let best: { priority: number; surface: TargetSurface } | null = null;
  for (const element of elements) {
    const priority = matchesSelector(element, REGION_SELECTOR) ? 3 : 2;
    if (!best || priority > best.priority) {
      const candidate = configuredDomTarget(element, selector);
      if (candidate) {
        if (priority === 3) return candidate;
        best = { priority, surface: candidate };
      }
    }
    if (!best) {
      const candidate = notebookTarget(element);
      if (candidate) best = { priority: 1, surface: candidate };
    }
  }
  if (best) return best.surface;
  const positions = new Map<Element, ScopedPosition | null>();
  for (const element of elements) {
    const fallback = domTarget(scopedDomRoot(element, positions));
    if (fallback) return fallback;
  }
  return null;
}

function notebookTarget(element: Element): TargetSurface | null {
  const output = outputCellFromRoot(element);
  if (!output || !isVisible(output.element)) return null;
  return surface(
    {
      kind: "notebook",
      cellIds: [output.id],
      documentId: documentIdentity(output.element.ownerDocument),
      documentPath: documentPath(output.element.ownerDocument),
    },
    output.element,
  );
}

function configuredDomTarget(element: Element, selector: TargetSelector): TargetSurface | null {
  return matchesSelector(element, DECLARED_TARGET_SELECTOR) ||
    (selector && matchesSelector(element, selector))
    ? domTarget(element)
    : null;
}

type ScopedPosition = {
  scope: HTMLElement;
  selector: string;
  group: HTMLElement | null;
  block: HTMLElement | null;
};

/** Share ancestor work within a synchronous read, never across DOM changes. */
function scopedDomRoot(
  element: Element,
  positions = new Map<Element, ScopedPosition | null>(),
): HTMLElement | null {
  if (!isHTMLElement(element)) return null;
  const pending: Element[] = [];
  let current: Element | null = element;
  while (current && !positions.has(current)) {
    pending.push(current);
    if (current.hasAttribute("data-marimo-lens-scope")) break;
    current = current.parentElement;
  }
  let position = current ? (positions.get(current) ?? null) : null;
  for (const node of pending.reverse()) {
    if (isHTMLElement(node) && node.hasAttribute("data-marimo-lens-scope")) {
      position = { scope: node, selector: scopeSelector(node), group: null, block: null };
    } else if (
      !position ||
      isLensUi(node) ||
      outputCellFromRoot(node) ||
      matchesSelector(node, `${DECLARED_TARGET_SELECTOR}, script, style, template, noscript`)
    ) {
      position = null;
    } else if (isHTMLElement(node)) {
      const group: HTMLElement | null =
        position.selector && matchesSelector(node, position.selector) ? node : position.group;
      let block: HTMLElement | null = position.block;
      if (!group) {
        const display = node.ownerDocument.defaultView?.getComputedStyle(node).display;
        if (display !== "inline" && display !== "contents" && display !== "none") block = node;
      }
      if (group !== position.group || block !== position.block)
        position = { ...position, group, block };
    }
    positions.set(node, position);
  }
  return position ? (position.group ?? position.block ?? position.scope) : null;
}

function scopeSelector(scope: Element): string {
  const selector = scope.getAttribute("data-marimo-lens-scope")?.trim() ?? "";
  if (!selector) return "";
  try {
    scope.matches(selector);
    return selector;
  } catch {
    return "";
  }
}

function domTarget(
  element: Element | null,
  ids?: ReadonlyMap<string, Element | null>,
): TargetSurface | null {
  if (!isHTMLElement(element) || element.getRootNode() !== element.ownerDocument) return null;
  if (
    isLensUi(element) ||
    containsLensHost(element) ||
    !isVisible(element) ||
    element.closest('[aria-busy="true"]') !== null
  ) {
    return null;
  }
  const sources = notebookSources(element, ids);
  if (sources === null) return null;
  return surface(
    {
      kind: "dom",
      cellIds: [...new Set(sources.map((source) => source.cellId))].sort(),
      sources,
      documentId: documentIdentity(element.ownerDocument),
      documentPath: documentPath(element.ownerDocument),
      domSelector: domSelector(element, ids),
    },
    element,
  );
}

function domSelector(
  element: HTMLElement,
  documentIds?: ReadonlyMap<string, Element | null>,
): string {
  const ownerDocument = element.ownerDocument;
  if (element.id) {
    const selector = `#${escapeIdentifier(element.id, ownerDocument)}`;
    if (
      selector.length <= 1_024 &&
      (documentIds?.get(element.id) === element ||
        ((!documentIds || documentIds.get(element.id) === null) &&
          queryTarget(ownerDocument, selector) === element))
    )
      return selector;
  }
  let ids = ownerDocument[TARGET_IDS];
  if (!ids) {
    ids = new WeakMap<HTMLElement, string>();
    Object.defineProperty(ownerDocument, TARGET_IDS, { value: ids });
  }
  let id = ids.get(element);
  if (!id) {
    id = Array.from(ownerDocument.defaultView!.crypto.getRandomValues(new Uint32Array(4))).join(
      "-",
    );
    ids.set(element, id);
  }
  const attribute = "data-marimo-lens-target-id";
  if (element.getAttribute(attribute) !== id) element.setAttribute(attribute, id);
  return `[${attribute}="${id}"]`;
}

function surface(target: SelectionTarget, element: HTMLElement): TargetSurface | null {
  try {
    const parsed = parseSelectionTarget(target);
    return { key: JSON.stringify(parsed), target: parsed, element };
  } catch {
    return null;
  }
}

function queryTarget(ownerDocument: Document, selector: string): HTMLElement | null {
  const matches = queryTargets(ownerDocument, selector);
  return matches.length === 1 ? matches[0]! : null;
}

function queryTargets(ownerDocument: Document, selector: string): HTMLElement[] {
  try {
    return Array.from(ownerDocument.querySelectorAll(selector)).filter(isHTMLElement);
  } catch {
    return [];
  }
}

function matchesSelector(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function documentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function documentPath(ownerDocument: Document): string {
  return ownerDocument.location?.pathname || "/";
}

export function documentIdentity(ownerDocument: Document): string {
  const existing = ownerDocument[DOCUMENT_ID];
  if (existing) return existing;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Lens requires a browser window");
  const id =
    ownerWindow.crypto.randomUUID?.() ??
    `${ownerWindow.Date.now().toString(36)}-${ownerWindow.Math.random().toString(36).slice(2, 10)}`;
  const created = `document:${id}`;
  // AnyWidget module instances share target identity for the lifetime of the document.
  Object.defineProperty(ownerDocument, DOCUMENT_ID, { value: created });
  return created;
}

function escapeIdentifier(value: string, ownerDocument: Document): string {
  const escape = ownerDocument.defaultView?.CSS?.escape;
  if (escape) return escape(value);
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    (character) => `\\${character.codePointAt(0)!.toString(16)} `,
  );
}

function isLensUi(element: Element): boolean {
  return element.closest("[data-marimo-lens-ui]") !== null;
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

function isHTMLElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow !== null && element instanceof ownerWindow.HTMLElement;
}

function isElement(value: EventTarget | null): value is Element {
  return value !== null && "nodeType" in value && value.nodeType === 1;
}

function isShadowRoot(value: Node): value is ShadowRoot {
  return value.nodeType === 11 && "host" in value;
}
