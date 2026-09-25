import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";
import { LensThemeContext, observeLensTheme, type LensTheme } from "@/ui/theme";

// Anywidget can mount views from separate app-module instances into one document.
// The global symbol lets those instances share one ordered registry.
const VIEW_REGISTRY: unique symbol = Symbol.for("marimo-lens.view-registry.v1");

type ViewOwnership = "owner" | "conflict";
type ViewRegistry = Map<symbol, (ownership: ViewOwnership) => void>;

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
  const conflictWarnedRef = useRef(false);
  const [ownedAdapter, setOwnedAdapter] = useState<NotebookDomAdapter | null>(null);
  const [theme, setTheme] = useState<LensTheme>("light");

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const releaseTheme = observeLensTheme(host.ownerDocument, setTheme);
    const adapter = new NotebookDomAdapter(host.ownerDocument);
    const releaseHostOutput = adapter.registerHost(host);
    const releaseView = acquireView(host.ownerDocument, viewId, (ownership) => {
      if (ownership === "conflict" && !conflictWarnedRef.current) {
        conflictWarnedRef.current = true;
        console.warn(
          "marimo-lens: another Lens view owns this browser document. " +
            "Use marimo_lens.agent.connect() to access it.",
        );
      }
      setOwnedAdapter(ownership === "owner" ? adapter : null);
    });
    return () => {
      releaseTheme();
      releaseView();
      releaseHostOutput();
      adapter.dispose();
    };
  }, [viewId]);

  return (
    <LensThemeContext value={theme}>
      <span ref={hostRef} hidden data-marimo-lens-host data-marimo-lens-ui />
      {ownedAdapter ? (
        <NotebookDomProvider adapter={ownedAdapter}>{children}</NotebookDomProvider>
      ) : null}
    </LensThemeContext>
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
