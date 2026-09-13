import {
  SOURCE_CELL_ATTRIBUTE,
  SOURCE_SELECTOR_ATTRIBUTE,
  SOURCE_INPUTS_ATTRIBUTE,
  type NotebookSource,
} from "@marimo-lens/protocol";

const SOURCE_SELECTOR = `[${SOURCE_CELL_ATTRIBUTE}], [${SOURCE_SELECTOR_ATTRIBUTE}], [${SOURCE_INPUTS_ATTRIBUTE}]`;

/** Resolve declared notebook sources in the owning document. */
export function notebookSources(element: HTMLElement): NotebookSource[] | null {
  const sources = new Map<string, NotebookSource>();
  const add = (host: Element): boolean => {
    const cellId = host.getAttribute(SOURCE_CELL_ATTRIBUTE)?.trim();
    if (!cellId) return false;
    const selector = host.getAttribute(SOURCE_SELECTOR_ATTRIBUTE)?.trim() ?? null;
    if (selector === "") return false;
    const source = { cellId, selector };
    sources.set(JSON.stringify(source), source);
    return sources.size <= 64;
  };
  const candidates = [element, ...element.querySelectorAll(SOURCE_SELECTOR)];
  for (const candidate of candidates) {
    // Source elements are opaque; explicit regions declare their complete input set.
    const owner = candidate.parentElement?.closest(SOURCE_SELECTOR);
    if (candidate !== element && owner && (owner === element || element.contains(owner))) continue;
    const references = candidate.getAttribute(SOURCE_INPUTS_ATTRIBUTE);
    if (references !== null) {
      const hosts = referencedSources(candidate);
      if (hosts === null || hosts.some((host) => !add(host))) return null;
    } else if (candidate.matches(SOURCE_SELECTOR) && !add(candidate)) {
      return null;
    }
  }
  return [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, source]) => source);
}

/** ID references are document-local, unique, and never followed recursively. */
export function referencedSources(element: Element): Element[] | null {
  const references = element.getAttribute(SOURCE_INPUTS_ATTRIBUTE);
  if (!references?.trim() || references.length > 4_096) return null;
  const ids = references.trim().split(/\s+/);
  if (ids.length > 64) return null;
  const byId = new Map<string, Element | null>();
  for (const host of element.ownerDocument.querySelectorAll("[id]")) {
    byId.set(host.id, byId.has(host.id) ? null : host);
  }
  const hosts = new Set<Element>();
  for (const id of ids) {
    const host = byId.get(id);
    if (!host || host.hasAttribute(SOURCE_INPUTS_ATTRIBUTE)) return null;
    hosts.add(host);
  }
  return [...hosts];
}
