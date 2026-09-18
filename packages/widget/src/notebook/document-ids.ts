/** One synchronous DOM read, including duplicate IDs, shared by a discovery pass. */
export function indexDocumentIds(ownerDocument: Document): ReadonlyMap<string, Element | null> {
  const byId = new Map<string, Element | null>();
  for (const element of ownerDocument.querySelectorAll("[id]")) {
    byId.set(element.id, byId.has(element.id) ? null : element);
  }
  return byId;
}
