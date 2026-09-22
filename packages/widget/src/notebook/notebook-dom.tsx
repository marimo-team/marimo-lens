import {
  TARGET_METADATA_ATTRIBUTES,
  CAPTURE_CONTEXT_ATTRIBUTE,
  type SelectionTarget,
  type TargetSelector,
} from "@marimo-lens/protocol";
import { createContext, useContext, type ReactNode } from "react";

import type { OutputCell } from "@/notebook/types";

import {
  iframeAtPoint,
  observeInteractionSurfaces,
  type InteractionSurface,
  type InteractionSurfaceOptions,
} from "@/notebook/interaction-documents";
import { composedClosest, containsOpenTree } from "@/notebook/open-tree";
import {
  deepestElementAtPoint,
  getOutputCell,
  listOutputCells,
  listOutputRoots,
  registerLensHostOutput,
} from "@/notebook/output-root";
import {
  DECLARED_TARGET_SELECTOR,
  TARGET_SCOPE,
  getTargetSurface,
  listTargetSurfaces,
  targetFromElement,
  targetFromEvent,
  type TargetSurface,
  validateTargetSelector,
} from "@/notebook/selection-target";
import { intersectBounds, windowViewportBounds, type ViewportBounds } from "@/notebook/viewport";

type LayoutListener = () => void;

const PAINT_FALLBACK_MS = 100;
const TARGET_ATTRIBUTES = new Set<string>([
  ...TARGET_METADATA_ATTRIBUTES,
  "data-marimo-lens-target",
  "data-marimo-lens-scope",
  "id",
]);

export class NotebookDomAdapter {
  readonly document: Document;
  readonly window: Window & typeof globalThis;

  #pane: HTMLElement | null = null;
  readonly #layoutListeners = new Set<LayoutListener>();
  readonly #viewportListeners = new Set<LayoutListener>();
  #selector: TargetSelector = null;
  #uiRoot: ShadowRoot | null = null;
  #stopLayoutObserver: (() => void) | null = null;
  #stopViewportObserver: (() => void) | null = null;
  #contentRevision = 0;
  readonly #contentRevisions = new WeakMap<HTMLElement, number>();

  constructor(ownerDocument: Document) {
    this.document = ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) throw new Error("Lens requires a browser window");
    this.window = ownerWindow;
  }

  get uiRoot(): Document | ShadowRoot {
    return this.#uiRoot ?? this.document;
  }

  registerUiRoot(root: ShadowRoot): () => void {
    if (root.ownerDocument !== this.document || this.#uiRoot) {
      throw new Error("Lens UI requires one root in its owning document");
    }
    this.#uiRoot = root;
    const { host } = root;
    host.toggleAttribute("data-marimo-lens-pane", this.#pane !== null);
    (this.#pane ?? this.document.body).append(host);
    const stopClip =
      this.#pane && host instanceof this.window.HTMLElement ? this.#clipToPane(host) : null;
    return () => {
      stopClip?.();
      host.remove();
      if (this.#uiRoot === root) this.#uiRoot = null;
    };
  }

  // `#App` forms a stacking context below marimo's application chrome, so Lens
  // cannot paint above panels, dialogs, or menus from inside it. The clip keeps
  // fixed Lens UI out of the chrome that `#App` still overlaps.
  #clipToPane(host: HTMLElement): () => void {
    const clip = () => {
      const pane = this.viewportBounds();
      const box = host.getBoundingClientRect();
      host.style.setProperty(
        "--marimo-lens-pane-clip",
        `inset(${pane.top - box.top}px ${box.right - pane.right}px ${box.bottom - pane.bottom}px ${pane.left - box.left}px)`,
      );
    };
    clip();
    return this.subscribeViewport(clip);
  }

  get activeElement(): Element | null {
    let element = this.document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  /** The visible notebook pane: marimo's `#App` scroller, or the visual viewport elsewhere. */
  viewportBounds(): ViewportBounds {
    const windowBounds = windowViewportBounds(this.window);
    const pane = this.#pane?.getBoundingClientRect();
    return (pane && intersectBounds(windowBounds, pane)) ?? windowBounds;
  }

  registerHost(host: Element): () => void {
    const pane = composedClosest(host, "#App");
    this.#pane = pane instanceof this.window.HTMLElement ? pane : null;
    const releaseOutput = registerLensHostOutput(host);
    return () => {
      releaseOutput();
      this.#pane = null;
    };
  }

  configureSelector(selector: TargetSelector): void {
    validateTargetSelector(this.document, selector);
    if (this.#selector === selector) return;
    this.#selector = selector;
    for (const listener of this.#layoutListeners) listener();
  }

  targetFromEvent(event: Event, selector: TargetSelector): TargetSurface | null {
    return targetFromEvent(event, selector);
  }

  targetFromElement(element: Element | null, selector: TargetSelector): TargetSurface | null {
    return targetFromElement(element, selector);
  }

  captureContext(element: HTMLElement): HTMLElement | "auto" {
    const context = element.closest<HTMLElement>(`[${CAPTURE_CONTEXT_ATTRIBUTE}]`);
    if (!context) return "auto";
    return context === this.document.body || context === this.document.documentElement
      ? element
      : context;
  }

  getTarget(target: SelectionTarget, selector: TargetSelector): TargetSurface | null {
    return getTargetSurface(this.document, target, selector);
  }

  listTargets(selector: TargetSelector): TargetSurface[] {
    return listTargetSurfaces(this.document, selector);
  }

  contentRevision(target: HTMLElement): number {
    // Geometry-only updates retain the descendant chosen for a scroll attachment.
    return this.#contentRevisions.get(target) ?? 0;
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

  stopScroll(target: HTMLElement): void {
    let node: Node | null = target;
    while (node) {
      if (node instanceof this.window.HTMLElement) {
        node.scrollTo({ top: node.scrollTop, left: node.scrollLeft, behavior: "instant" });
      }
      node = node.parentNode ?? (node instanceof this.window.ShadowRoot ? node.host : null);
    }
  }

  deepestElementAtPoint(x: number, y: number): Element | null {
    return deepestElementAtPoint(this.document, x, y);
  }

  iframeAtPoint(point: { x: number; y: number }, target: TargetSurface): HTMLIFrameElement | null {
    return iframeAtPoint(point, target.element);
  }

  observeInteractionSurfaces(
    options: InteractionSurfaceOptions,
    attach: (surface: InteractionSurface) => () => void,
  ): () => void {
    return observeInteractionSurfaces(this.document, options, attach);
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

  subscribeLayout(listener: LayoutListener, selector?: TargetSelector): () => void {
    if (selector !== undefined) this.configureSelector(selector);
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

  subscribeViewport(listener: LayoutListener): () => void {
    this.#viewportListeners.add(listener);
    this.#stopViewportObserver ??= this.#observeViewport();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#viewportListeners.delete(listener);
      if (this.#viewportListeners.size > 0) return;
      this.#stopViewportObserver?.();
      this.#stopViewportObserver = null;
    };
  }

  dispose(): void {
    this.#layoutListeners.clear();
    this.#viewportListeners.clear();
    this.#stopLayoutObserver?.();
    this.#stopLayoutObserver = null;
    this.#stopViewportObserver?.();
    this.#stopViewportObserver = null;
  }

  #observeViewport(): () => void {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = this.window.requestAnimationFrame(() => {
        frame = 0;
        for (const listener of this.#viewportListeners) listener();
      });
    };
    const pane = this.#pane;
    const observer =
      pane && this.window.ResizeObserver ? new this.window.ResizeObserver(schedule) : null;
    if (pane) observer?.observe(pane);
    this.window.addEventListener("resize", schedule);
    this.window.visualViewport?.addEventListener("resize", schedule);
    this.window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) this.window.cancelAnimationFrame(frame);
      observer?.disconnect();
      this.window.removeEventListener("resize", schedule);
      this.window.visualViewport?.removeEventListener("resize", schedule);
      this.window.visualViewport?.removeEventListener("scroll", schedule);
    };
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

    const resized = () => {
      invalidateContent();
      schedule();
    };
    const scrolled = (event: Event) => {
      if (event.target instanceof this.window.Element) invalidateContent([event.target]);
      schedule();
    };
    this.window.addEventListener("resize", resized);
    this.window.addEventListener("scroll", scrolled, true);
    // Pane geometry moves every target without changing target content.
    const stopViewport = this.subscribeViewport(() => {
      for (const listener of this.#layoutListeners) listener();
    });

    const inDomRegion = (node: Node) => {
      if (!(node instanceof this.window.Element)) return false;
      if (node.closest(TARGET_SCOPE)) return true;
      try {
        return node.closest(DECLARED_TARGET_SELECTOR) !== null;
      } catch {
        return false;
      }
    };
    const observedOutputs = new Set<HTMLElement>();
    const observedShadows = new Set<ShadowRoot>();
    const invalidateContent = (targets?: readonly Node[]) => {
      const revision = ++this.#contentRevision;
      for (const output of observedOutputs) {
        if (
          !targets ||
          targets.some(
            (target) => containsOpenTree(output, target) || containsOpenTree(target, output),
          )
        ) {
          this.#contentRevisions.set(output, revision);
        }
      }
    };
    const MutationObserverClass = this.window.MutationObserver;
    const mutationObserver = MutationObserverClass
      ? new MutationObserverClass((records) => {
          if (records.length > 0) {
            records = records.filter((record) => record.target.getRootNode() !== this.#uiRoot);
            if (records.length === 0) return;
          }
          let currentTargets: HTMLElement[] | null = null;
          const affectsTargets =
            records.length === 0 ||
            records.some((record) => {
              if (record.type !== "attributes") return true;
              if (TARGET_ATTRIBUTES.has(record.attributeName ?? "")) return true;
              const target = record.target;
              if (!(target instanceof this.window.HTMLElement)) return false;
              if (target.closest("[data-marimo-lens-ui]")) return false;
              const related = (root: HTMLElement) =>
                containsOpenTree(root, target) || containsOpenTree(target, root);
              if ([...observedOutputs].some(related)) return true;
              if (this.#selector === null && !inDomRegion(target)) return false;
              currentTargets ??= this.listTargets(this.#selector).map(({ element }) => element);
              return currentTargets.some(related);
            });
          if (!affectsTargets) return;
          invalidateContent(records.length === 0 ? undefined : records.map(({ target }) => target));
          const topologyChanged =
            records.length === 0 ||
            records.some(
              (record) =>
                (record.type === "attributes" &&
                  (this.#selector !== null ||
                    inDomRegion(record.target) ||
                    TARGET_ATTRIBUTES.has(record.attributeName ?? ""))) ||
                [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1),
            );
          if (topologyChanged) scheduleTopology();
          else schedule();
        })
      : null;
    const mutationOptions = {
      attributes: true,
      childList: true,
      subtree: true,
    } satisfies MutationObserverInit;
    const ResizeObserverClass = this.window.ResizeObserver;
    const resizeObserver = ResizeObserverClass
      ? new ResizeObserverClass((entries) => {
          invalidateContent(entries.length === 0 ? undefined : entries.map(({ target }) => target));
          schedule();
        })
      : null;
    const syncTopology = () => {
      const outputs = new Set([
        ...listOutputRoots(this.document).map((output) => output.element),
        ...this.listTargets(this.#selector).map((target) => target.element),
      ]);
      for (const output of observedOutputs) {
        if (outputs.has(output)) continue;
        resizeObserver?.unobserve(output);
        observedOutputs.delete(output);
      }
      for (const output of outputs) {
        if (observedOutputs.has(output)) continue;
        observedOutputs.add(output);
        this.#contentRevisions.set(output, this.#contentRevision);
        resizeObserver?.observe(output);
      }

      const shadows = new Set(listOpenShadowRoots(this.document.body));
      let removedShadow = false;
      for (const shadow of observedShadows) {
        if (shadows.has(shadow)) continue;
        shadow.removeEventListener("scroll", scrolled, true);
        observedShadows.delete(shadow);
        removedShadow = true;
      }
      const addedShadows: ShadowRoot[] = [];
      for (const shadow of shadows) {
        if (observedShadows.has(shadow)) continue;
        observedShadows.add(shadow);
        addedShadows.push(shadow);
        shadow.addEventListener("scroll", scrolled, true);
      }
      if (removedShadow) {
        mutationObserver?.disconnect();
        mutationObserver?.observe(this.document.body, mutationOptions);
        for (const shadow of observedShadows) {
          mutationObserver?.observe(shadow, mutationOptions);
        }
      } else {
        for (const shadow of addedShadows) {
          mutationObserver?.observe(shadow, mutationOptions);
        }
      }
    };
    resizeObserver?.observe(this.document.body);
    mutationObserver?.observe(this.document.body, mutationOptions);
    syncTopology();

    return () => {
      if (frame) this.window.cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedOutputs.clear();
      for (const shadow of observedShadows) {
        shadow.removeEventListener("scroll", scrolled, true);
      }
      observedShadows.clear();
      stopViewport();
      this.window.removeEventListener("resize", resized);
      this.window.removeEventListener("scroll", scrolled, true);
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
