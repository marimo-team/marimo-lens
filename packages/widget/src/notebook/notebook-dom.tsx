import { createContext, useContext, type ReactNode } from "react";

import type { OutputCell } from "@/notebook/types";

import {
  iframeAtPoint,
  observeInteractionSurfaces,
  type InteractionSurface,
} from "@/notebook/interaction-documents";
import {
  deepestElementAtPoint,
  getOutputCell,
  listOutputCells,
  listOutputRoots,
  registerLensHostOutput,
} from "@/notebook/output-root";

type LayoutListener = () => void;

const PAINT_FALLBACK_MS = 100;

export class NotebookDomAdapter {
  readonly document: Document;
  readonly window: Window & typeof globalThis;

  readonly #layoutListeners = new Set<LayoutListener>();
  #stopLayoutObserver: (() => void) | null = null;

  constructor(ownerDocument: Document) {
    this.document = ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) throw new Error("Lens requires a browser window");
    this.window = ownerWindow;
  }

  get portalTarget(): HTMLElement {
    return this.document.body;
  }

  registerHost(host: Element): () => void {
    return registerLensHostOutput(host);
  }

  getOutputCell(outputCellId: string): OutputCell | null {
    return getOutputCell(this.document, outputCellId);
  }

  getCell(cellId: string): HTMLElement | null {
    const element = this.document.getElementById(`cell-${cellId}`);
    return element instanceof this.window.HTMLElement ? element : null;
  }

  listOutputCells(): OutputCell[] {
    return listOutputCells(this.document);
  }

  deepestElementAtPoint(x: number, y: number): Element | null {
    return deepestElementAtPoint(this.document, x, y);
  }

  iframeAtPoint(point: { x: number; y: number }, output: OutputCell): HTMLIFrameElement | null {
    return iframeAtPoint(point, output);
  }

  observeInteractionSurfaces(
    armed: boolean,
    attach: (surface: InteractionSurface) => () => void,
  ): () => void {
    return observeInteractionSurfaces(this.document, armed, attach);
  }

  afterNextPaint(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(
          signal.reason ?? new this.window.DOMException("Operation was canceled", "AbortError"),
        );
        return;
      }
      if (this.document.hidden) {
        // Hidden documents have no next paint. Resolving this promise queues
        // the capture after the current browser callback without depending on
        // throttled animation frames or timers.
        resolve();
        return;
      }

      let settled = false;
      let frame = 0;
      let fallback = 0;
      const cleanup = () => {
        this.window.cancelAnimationFrame(frame);
        this.window.clearTimeout(fallback);
        signal.removeEventListener("abort", abort);
      };
      const complete = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          signal.reason ?? new this.window.DOMException("Operation was canceled", "AbortError"),
        );
      };

      signal.addEventListener("abort", abort, { once: true });
      frame = this.window.requestAnimationFrame(complete);
      // A visible document can still miss a frame while its renderer is
      // suspended. Keep capture progress bounded in that state.
      fallback = this.window.setTimeout(complete, PAINT_FALLBACK_MS);
    });
  }

  subscribeLayout(listener: LayoutListener): () => void {
    this.#layoutListeners.add(listener);
    this.#stopLayoutObserver ??= this.#observeLayout();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#layoutListeners.delete(listener);
      if (this.#layoutListeners.size > 0) return;
      this.#stopLayoutObserver?.();
      this.#stopLayoutObserver = null;
    };
  }

  dispose(): void {
    this.#layoutListeners.clear();
    this.#stopLayoutObserver?.();
    this.#stopLayoutObserver = null;
  }

  #observeLayout(): () => void {
    let frame = 0;
    let topologyDirty = false;
    const schedule = () => {
      if (frame) return;
      frame = this.window.requestAnimationFrame(() => {
        frame = 0;
        if (topologyDirty) {
          topologyDirty = false;
          syncTopology();
        }
        for (const listener of this.#layoutListeners) listener();
      });
    };
    const scheduleTopology = () => {
      topologyDirty = true;
      schedule();
    };

    this.window.addEventListener("resize", schedule);
    this.window.addEventListener("scroll", schedule, true);

    const MutationObserverClass = this.window.MutationObserver;
    const mutationObserver = MutationObserverClass
      ? new MutationObserverClass(scheduleTopology)
      : null;
    const ResizeObserverClass = this.window.ResizeObserver;
    const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(schedule) : null;
    const observedOutputs = new Set<HTMLElement>();
    const observedShadows = new Set<ShadowRoot>();
    const syncTopology = () => {
      if (resizeObserver) {
        const outputs = new Set(listOutputRoots(this.document).map((output) => output.element));
        for (const output of observedOutputs) {
          if (outputs.has(output)) continue;
          resizeObserver.unobserve(output);
          observedOutputs.delete(output);
        }
        for (const output of outputs) {
          if (observedOutputs.has(output)) continue;
          observedOutputs.add(output);
          resizeObserver.observe(output);
        }
      }

      const shadows = new Set(listOpenShadowRoots(this.document.body));
      for (const shadow of observedShadows) {
        if (shadows.has(shadow)) continue;
        shadow.removeEventListener("scroll", schedule, true);
        observedShadows.delete(shadow);
      }
      for (const shadow of shadows) {
        if (observedShadows.has(shadow)) continue;
        observedShadows.add(shadow);
        shadow.addEventListener("scroll", schedule, true);
        mutationObserver?.observe(shadow, {
          childList: true,
          subtree: true,
        });
      }
    };
    resizeObserver?.observe(this.document.body);
    mutationObserver?.observe(this.document.body, {
      childList: true,
      subtree: true,
    });
    syncTopology();

    return () => {
      if (frame) this.window.cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedOutputs.clear();
      for (const shadow of observedShadows) {
        shadow.removeEventListener("scroll", schedule, true);
      }
      observedShadows.clear();
      this.window.removeEventListener("resize", schedule);
      this.window.removeEventListener("scroll", schedule, true);
    };
  }
}

function listOpenShadowRoots(root: ParentNode): ShadowRoot[] {
  const shadows: ShadowRoot[] = [];
  const visit = (parent: ParentNode) => {
    for (const element of parent.children) {
      if (element.shadowRoot) {
        shadows.push(element.shadowRoot);
        visit(element.shadowRoot);
      }
      visit(element);
    }
  };
  visit(root);
  return shadows;
}

const NotebookDomContext = createContext<NotebookDomAdapter | null>(null);

export function NotebookDomProvider({
  adapter,
  children,
}: {
  adapter: NotebookDomAdapter;
  children: ReactNode;
}) {
  return <NotebookDomContext value={adapter}>{children}</NotebookDomContext>;
}

export function useNotebookDom(): NotebookDomAdapter {
  const adapter = useContext(NotebookDomContext);
  if (!adapter) throw new Error("Lens notebook DOM is unavailable");
  return adapter;
}
