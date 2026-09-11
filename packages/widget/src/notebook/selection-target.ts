import type { SelectionTarget, TargetSelector } from "@marimo-lens/protocol";

import { parseSelectionTarget } from "@marimo-lens/protocol";

import { containsOpenTree } from "@/notebook/open-tree";
import {
  containsLensHost,
  getOutputCell,
  listOutputRoots,
  outputCellFromRoot,
} from "@/notebook/output-root";
import { notebookSources } from "@/notebook/projection-sources";

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
    const root = current.getRootNode();
    current = current.parentElement ?? (isShadowRoot(root) ? root.host : null);
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
  if (!selector) return null;
  const element = queryTarget(ownerDocument, target.domSelector);
  if (!element) return null;
  const current = configuredDomTarget(element, selector);
  return current?.key === surface(target, element)?.key ? current : null;
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
  const candidates: Array<{ priority: number; surface: TargetSurface }> = [];
  if (selector) {
    queryTargets(ownerDocument, selector).forEach((element) => {
      const candidate = domTarget(element);
      if (candidate) candidates.push({ priority: 2, surface: candidate });
    });
  }
  listOutputRoots(ownerDocument).forEach((output) => {
    const candidate = notebookTarget(output.element);
    if (candidate) candidates.push({ priority: 1, surface: candidate });
  });

  const strongest = new Map<HTMLElement, { priority: number; surface: TargetSurface }>();
  for (const candidate of candidates) {
    const current = strongest.get(candidate.surface.element);
    if (!current || candidate.priority > current.priority) {
      strongest.set(candidate.surface.element, candidate);
    }
  }
  const unique = [...strongest.values()];
  return unique
    .filter(
      (candidate) =>
        !unique.some(
          (other) =>
            other.priority > candidate.priority &&
            containsOpenTree(other.surface.element, candidate.surface.element),
        ),
    )
    .map(({ surface }) => surface)
    .filter(({ element }) => isVisible(element))
    .sort((left, right) => documentOrder(left.element, right.element));
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
    const candidates = [
      selector ? ranked(2, configuredDomTarget(element, selector)) : null,
      ranked(1, notebookTarget(element)),
    ];
    for (const candidate of candidates) {
      if (candidate && (!best || candidate.priority > best.priority)) best = candidate;
    }
  }
  return best?.surface ?? null;
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

function configuredDomTarget(element: Element, selector: string): TargetSurface | null {
  return matchesSelector(element, selector) ? domTarget(element) : null;
}

function domTarget(element: Element): TargetSurface | null {
  if (!isHTMLElement(element) || element.getRootNode() !== element.ownerDocument) return null;
  if (
    isLensUi(element) ||
    containsLensHost(element) ||
    !isVisible(element) ||
    element.closest('[aria-busy="true"]') !== null
  ) {
    return null;
  }
  const sources = notebookSources(element);
  if (sources === null) return null;
  return surface(
    {
      kind: "dom",
      cellIds: [...new Set(sources.map((source) => source.cellId))].sort(),
      sources,
      documentId: documentIdentity(element.ownerDocument),
      documentPath: documentPath(element.ownerDocument),
      domSelector: domSelector(element),
    },
    element,
  );
}

function domSelector(element: HTMLElement): string {
  const ownerDocument = element.ownerDocument;
  if (element.id) {
    const selector = `#${escapeIdentifier(element.id, ownerDocument)}`;
    if (selector.length <= 1_024 && queryTarget(ownerDocument, selector) === element)
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

function ranked(priority: number, value: TargetSurface | null) {
  return value ? { priority, surface: value } : null;
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
