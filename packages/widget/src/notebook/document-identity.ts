import type { SelectionTarget } from "@marimo-lens/protocol";

// Authored targets and published projection sources belong to each document,
// including when one default Lens model is shared by several views.
const DOCUMENT_ID: unique symbol = Symbol.for("marimo-lens.document-id.v1");

declare global {
  interface Document {
    [DOCUMENT_ID]?: string;
  }
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

export function documentPath(ownerDocument: Document): string {
  return ownerDocument.location?.pathname || "/";
}

export function targetBelongsToDocument(target: SelectionTarget, ownerDocument: Document): boolean {
  return (
    target.documentId === documentIdentity(ownerDocument) &&
    target.documentPath === documentPath(ownerDocument)
  );
}

/** Return `target` as owned by `ownerDocument`, as a reopened record entry is. */
export function targetInDocument<Target extends SelectionTarget>(
  target: Target,
  ownerDocument: Document,
): Target {
  return {
    ...target,
    documentId: documentIdentity(ownerDocument),
    documentPath: documentPath(ownerDocument),
  };
}
