import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";
import { LensThemeContext, observeLensTheme, type LensTheme } from "@/ui/theme";

// Anywidget can mount views from separate app-module instances into one document.
// The global symbol lets those instances share one ordered registry.
const VIEW_REGISTRY: unique symbol = Symbol.for("marimo-lens.view-registry.v2");

// A duplicate view renders the owning Lens again, as a host preview can.
type ViewOwnership = "owner" | "duplicate" | "conflict";
type ViewListener = (ownership: ViewOwnership) => void;
type ViewRegistry = Map<
  symbol,
  { lensId: string | undefined; host: Element; listener: ViewListener }
>;

declare global {
  interface Document {
    [VIEW_REGISTRY]?: ViewRegistry;
  }
}

export function LensViewOwner({ children, lensId }: { children: ReactNode; lensId?: string }) {
  const [viewId] = useState(() => Symbol("marimo-lens-view"));
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
    const releaseView = acquireView(host, viewId, lensId, (ownership) => {
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
  }, [lensId, viewId]);

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
  host: Element,
  viewId: symbol,
  lensId: string | undefined,
  listener: ViewListener,
): () => void {
  const ownerDocument = host.ownerDocument;
  const views = viewRegistry(ownerDocument);
  views.set(viewId, { lensId, host, listener });
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

    // A cleared output releases all of its views in one task, and React flushes
    // the next owner synchronously inside this unmount. Handing ownership over
    // after the task keeps a departing view from announcing capture readiness.
    queueMicrotask(() => {
      if (views.size > 0) publishOwnership(views);
    });
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

/**
 * The Lens shown first in the document owns it, so a Lens whose cell reruns
 * keeps the dock from a Lens below it. Among views of that Lens, the first
 * registered owns and later ones, such as a host preview, are duplicates.
 */
function publishOwnership(views: ViewRegistry): void {
  let first: { lensId: string | undefined; host: Element } | undefined;
  for (const view of views.values()) {
    if (first === undefined || precedes(view.host, first.host)) first = view;
  }
  let owner: { lensId: string | undefined } | undefined;
  for (const view of views.values()) {
    if (owner === undefined && (view === first || sameLens(view, first))) {
      owner = view;
      view.listener("owner");
    } else {
      view.listener(owner !== undefined && sameLens(view, owner) ? "duplicate" : "conflict");
    }
  }
}

function sameLens(view: { lensId: string | undefined }, other?: { lensId: string | undefined }) {
  return view.lensId !== undefined && view.lensId === other?.lensId;
}

/** Say whether `host` comes before `other` in the document, across open shadow roots. */
function precedes(host: Element, other: Element): boolean {
  const position = documentAnchor(host).compareDocumentPosition(documentAnchor(other));
  return (
    (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
    (position & Node.DOCUMENT_POSITION_DISCONNECTED) === 0
  );
}

function documentAnchor(element: Element): Element {
  let anchor = element;
  for (let root = anchor.getRootNode(); root instanceof ShadowRoot; root = anchor.getRootNode()) {
    anchor = root.host;
  }
  return anchor;
}
