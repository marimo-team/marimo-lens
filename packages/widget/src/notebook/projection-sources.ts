import type { NotebookSource } from "@marimo-lens/protocol";

export const SOURCES_ATTRIBUTE = "data-marimo-sources";
const SOURCE_SELECTOR = `[data-runtime-cell-id], [${SOURCES_ATTRIBUTE}]`;

/** Resolve rendered regions through existing projection hosts in this document. */
export function notebookSources(element: HTMLElement): NotebookSource[] | null {
  const sources = new Map<string, NotebookSource>();
  const add = (host: Element): boolean => {
    const cellId = host.getAttribute("data-runtime-cell-id")?.trim();
    if (!cellId) return false;
    const kind = host.getAttribute("data-marimo-projection-kind");
    const selector =
      kind === "value" || kind === "output"
        ? host.getAttribute("data-marimo-projection-target")?.trim()
        : null;
    if (selector === "" || selector === undefined) return false;
    const source = { cellId, selector };
    sources.set(JSON.stringify(source), source);
    return sources.size <= 64;
  };
  const candidates = [element, ...element.querySelectorAll(SOURCE_SELECTOR)];
  for (const candidate of candidates) {
    // Native outputs are opaque; an explicit region declares its complete input set.
    const owner = candidate.parentElement?.closest(
      `[data-marimo-projection-kind], [${SOURCES_ATTRIBUTE}]`,
    );
    if (candidate !== element && owner && (owner === element || element.contains(owner))) continue;
    const references = candidate.getAttribute(SOURCES_ATTRIBUTE);
    if (references !== null) {
      const hosts = referencedSources(candidate);
      if (hosts === null || hosts.some((host) => !add(host))) return null;
    } else if (candidate.hasAttribute("data-runtime-cell-id") && !add(candidate)) {
      return null;
    }
  }
  return [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, source]) => source);
}

/** ID references are document-local, unique, and never followed recursively. */
export function referencedSources(element: Element): Element[] | null {
  const references = element.getAttribute(SOURCES_ATTRIBUTE);
  if (!references?.trim() || references.length > 4_096) return null;
  const ids = references.trim().split(/\s+/);
  if (ids.length > 64) return null;
  const candidates = Array.from(element.ownerDocument.querySelectorAll("[id]"));
  const hosts = new Set<Element>();
  for (const id of ids) {
    const matches = candidates.filter((host) => host.id === id);
    if (matches.length !== 1 || matches[0]!.hasAttribute(SOURCES_ATTRIBUTE)) return null;
    hosts.add(matches[0]!);
  }
  return [...hosts];
}
