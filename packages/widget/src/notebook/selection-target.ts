import type { SelectionTarget, TargetSelector } from "@marimo-lens/protocol";

import { parseSelectionTarget } from "@marimo-lens/protocol";

import { containsOpenTree } from "@/notebook/open-tree";
import {
  containsLensHost,
  getOutputCell,
  listOutputRoots,
  outputCellFromRoot,
} from "@/notebook/output-root";

const DOCUMENT_POSITION_FOLLOWING = 4;
const DOCUMENT_IDS = new WeakMap<Document, string>();

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
  if (
    !element ||
    !matchesSelector(element, selector) ||
    containsLensHost(element) ||
    !isVisible(element)
  ) {
    return null;
  }
  const cellIds = inferredCellIds(element);
  if (!sameCellIds(cellIds, target.cellIds)) return null;
  return surface(target, element);
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
  if (isLensUi(element) || containsLensHost(element) || !isVisible(element)) {
    return null;
  }
  const cellIds = inferredCellIds(element);
  for (const selector of domSelectors(element)) {
    const candidate = surface(
      {
        kind: "dom",
        cellIds,
        documentId: documentIdentity(element.ownerDocument),
        documentPath: documentPath(element.ownerDocument),
        domSelector: selector,
      },
      element,
    );
    if (candidate) return candidate;
  }
  return null;
}

function inferredCellIds(element: HTMLElement): string[] {
  const ids: string[] = [];
  const add = (candidate: Element) => {
    if (!isHTMLElement(candidate)) return;
    const cellId = candidate.dataset.runtimeCellId?.trim();
    if (cellId && !ids.includes(cellId)) ids.push(cellId);
  };
  add(element);
  element.querySelectorAll("[data-runtime-cell-id]").forEach(add);
  return ids.sort();
}

function domSelectors(element: HTMLElement): string[] {
  const ownerDocument = element.ownerDocument;
  const selectors: string[] = [];
  const add = (selector: string) => {
    if (!selectors.includes(selector) && queryTarget(ownerDocument, selector) === element) {
      selectors.push(selector);
    }
  };
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  while (current) {
    if (current.id) {
      const byId = `#${escapeIdentifier(current.id, ownerDocument)}`;
      add(parts.length > 0 ? `${byId} > ${parts.join(" > ")}` : byId);
    }
    parts.unshift(selectorPart(current));
    if (current === ownerDocument.body) break;
    current = current.parentElement;
  }
  add(parts.join(" > "));
  return selectors;
}

function selectorPart(element: HTMLElement): string {
  const parent = element.parentElement;
  if (!parent) return element.localName;
  const siblings = Array.from(parent.children).filter(
    (candidate) => candidate.localName === element.localName,
  );
  return siblings.length > 1
    ? `${element.localName}:nth-of-type(${siblings.indexOf(element) + 1})`
    : element.localName;
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

function sameCellIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cellId, index) => cellId === right[index]);
}

function documentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function documentPath(ownerDocument: Document): string {
  return ownerDocument.location?.pathname || "/";
}

export function documentIdentity(ownerDocument: Document): string {
  const existing = DOCUMENT_IDS.get(ownerDocument);
  if (existing) return existing;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Lens requires a browser window");
  const created = `document:${ownerWindow.crypto.randomUUID()}`;
  DOCUMENT_IDS.set(ownerDocument, created);
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
