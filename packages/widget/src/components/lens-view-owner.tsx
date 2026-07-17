import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { registerLensHostOutput } from "@/capture/output-root";

// Anywidget can load one app module per model while ownership spans the document.
// The global symbol lets those module instances share one ordered registry.
const VIEW_REGISTRY = Symbol.for("marimo-lens.view-registry.v1");

type ViewOwnership = "owner" | "standby" | "conflict";
type ViewEntry = {
  model: object;
  listener: (ownership: ViewOwnership) => void;
};
type ViewRegistry = Map<symbol, ViewEntry>;

export function LensViewOwner({ children, model }: { children: ReactNode; model: object }) {
  const viewId = useRef(Symbol("marimo-lens-view"));
  const hostRef = useRef<HTMLSpanElement>(null);
  const [ownership, setOwnership] = useState<ViewOwnership>(() =>
    typeof document === "undefined" ? "owner" : "standby",
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const releaseHostOutput = registerLensHostOutput(host);
    const releaseView = acquireView(host.ownerDocument, viewId.current, model, setOwnership);
    return () => {
      releaseView();
      releaseHostOutput();
    };
  }, [model]);

  return (
    <>
      <span ref={hostRef} hidden data-marimo-lens-host data-marimo-lens-ui />
      {ownership === "owner" ? children : null}
      {ownership === "conflict" ? <LensModelConflict /> : null}
    </>
  );
}

function acquireView(
  ownerDocument: Document,
  viewId: symbol,
  model: object,
  listener: ViewEntry["listener"],
): () => void {
  const views = viewRegistry(ownerDocument);
  views.set(viewId, { model, listener });
  publishOwnership(views);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    views.delete(viewId);

    if (views.size === 0) {
      if (Reflect.get(ownerDocument, VIEW_REGISTRY) === views) {
        Reflect.deleteProperty(ownerDocument, VIEW_REGISTRY);
      }
      return;
    }

    publishOwnership(views);
  };
}

function viewRegistry(ownerDocument: Document): ViewRegistry {
  const existing: unknown = Reflect.get(ownerDocument, VIEW_REGISTRY);
  if (existing instanceof Map) return existing as ViewRegistry;

  const views: ViewRegistry = new Map();
  Object.defineProperty(ownerDocument, VIEW_REGISTRY, {
    configurable: true,
    value: views,
  });
  return views;
}

function publishOwnership(views: ViewRegistry): void {
  const ownerEntry = views.values().next().value;
  if (!ownerEntry) return;

  let ownerPublished = false;
  for (const entry of views.values()) {
    if (entry.model !== ownerEntry.model) {
      entry.listener("conflict");
      continue;
    }

    entry.listener(ownerPublished ? "standby" : "owner");
    ownerPublished = true;
  }
}

function LensModelConflict() {
  return (
    <output
      className="marimo_lens ml-model-conflict"
      data-marimo-lens-model-conflict
      data-marimo-lens-ui
    >
      <strong>Lens is already active</strong>
      <span>Use the existing Lens instance in this notebook.</span>
    </output>
  );
}
