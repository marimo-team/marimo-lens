import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";

// Anywidget can mount views from separate app-module instances into one document.
// The global symbol lets those instances share one ordered registry.
const VIEW_REGISTRY: unique symbol = Symbol.for("marimo-lens.view-registry.v1");

type ViewOwnership = "owner" | "conflict";
type ViewRegistry = Map<symbol, (ownership: ViewOwnership) => void>;
type OwnedView = { adapter: NotebookDomAdapter; ownership: ViewOwnership };

declare global {
  interface Document {
    [VIEW_REGISTRY]?: ViewRegistry;
  }
}

export function LensViewOwner({ children }: { children: ReactNode }) {
  const viewIdRef = useRef<symbol | null>(null);
  if (viewIdRef.current === null) viewIdRef.current = Symbol("marimo-lens-view");
  const viewId = viewIdRef.current;
  const hostRef = useRef<HTMLSpanElement>(null);
  const [ownedView, setOwnedView] = useState<OwnedView | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const adapter = new NotebookDomAdapter(host.ownerDocument);
    const releaseHostOutput = adapter.registerHost(host);
    const releaseView = acquireView(host.ownerDocument, viewId, (ownership) => {
      setOwnedView({ adapter, ownership });
    });
    return () => {
      releaseView();
      releaseHostOutput();
      adapter.dispose();
    };
  }, [viewId]);

  return (
    <>
      <span ref={hostRef} hidden data-marimo-lens-host data-marimo-lens-ui />
      {ownedView?.ownership === "owner" ? (
        <NotebookDomProvider adapter={ownedView.adapter}>{children}</NotebookDomProvider>
      ) : null}
      {ownedView?.ownership === "conflict" ? <LensViewConflict /> : null}
    </>
  );
}

function acquireView(
  ownerDocument: Document,
  viewId: symbol,
  listener: (ownership: ViewOwnership) => void,
): () => void {
  const views = viewRegistry(ownerDocument);
  views.set(viewId, listener);
  publishOwnership(views);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    views.delete(viewId);

    if (views.size === 0) {
      if (ownerDocument[VIEW_REGISTRY] === views) delete ownerDocument[VIEW_REGISTRY];
      return;
    }

    publishOwnership(views);
  };
}

function viewRegistry(ownerDocument: Document): ViewRegistry {
  const existing = ownerDocument[VIEW_REGISTRY];
  if (existing) return existing;

  const views: ViewRegistry = new Map();
  Object.defineProperty(ownerDocument, VIEW_REGISTRY, {
    configurable: true,
    value: views,
  });
  return views;
}

function publishOwnership(views: ViewRegistry): void {
  let ownerPublished = false;
  for (const listener of views.values()) {
    listener(ownerPublished ? "conflict" : "owner");
    ownerPublished = true;
  }
}

function LensViewConflict() {
  return (
    <output
      className="marimo_lens ml-view-conflict"
      data-marimo-lens-view-conflict
      data-marimo-lens-ui
    >
      <strong>Lens is already active</strong>
      <span>Use the existing Lens instance in this notebook.</span>
    </output>
  );
}
