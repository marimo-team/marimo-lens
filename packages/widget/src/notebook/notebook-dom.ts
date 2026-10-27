import {
  CAPTURE_CONTEXT_ATTRIBUTE,
  TARGET_METADATA_ATTRIBUTES,
  type SelectionTarget,
  type TargetSelector,
} from "@marimo-lens/protocol";

import type { TargetSurface } from "@/notebook/target-surface";
import type { OutputCell } from "@/notebook/types";

import {
  iframeAtPoint,
  observeInteractionSurfaces,
  scanOpenTree,
  type InteractionSurface,
  type InteractionSurfaceOptions,
} from "@/notebook/interaction-documents";
import { composedClosest, containsOpenTree, someOpenTreeElement } from "@/notebook/open-tree";
import {
  deepestElementAtPoint,
  getOutputCell,
  listOutputRoots,
  OUTPUT_ROOT_SELECTOR,
  registerLensHostOutput,
} from "@/notebook/output-root";
import {
  getTargetSurface,
  listTargetSurfaces,
  targetFromElement,
  targetFromEvent,
  validateTargetSelector,
} from "@/notebook/selection-target";
import { DECLARED_TARGET_SELECTOR, TARGET_SCOPE } from "@/notebook/target-surface";
import { intersectBounds, windowViewportBounds, type ViewportBounds } from "@/notebook/viewport";

// marimo's save, layout, command, and run buttons stack in this column, and
// its menu, settings, and shutdown buttons sit in this row.
const MARIMO_COLUMN_SELECTOR = '[data-testid="chrome-controls-bottom-right"]';
const MARIMO_ROW_SELECTOR = '[data-testid="chrome-controls-top-right"]';
const CONTROLS_GAP = 8;

const TOPOLOGY_SELECTOR = [
  OUTPUT_ROOT_SELECTOR,
  DECLARED_TARGET_SELECTOR,
  TARGET_SCOPE,
  '[id^="cell-"][data-cell-id]',
].join(", ");

const TARGET_ATTRIBUTES = new Set<string>([
  ...TARGET_METADATA_ATTRIBUTES,
  "data-marimo-lens-target",
  "data-marimo-lens-scope",
  "id",
]);

type LayoutListener = () => void;

const PAINT_FALLBACK_MS = 100;

export class NotebookDomAdapter {
  readonly document: Document;
  readonly window: Window & typeof globalThis;

  #pane: HTMLElement | null = null;
  readonly #layoutListeners = new Set<LayoutListener>();
  readonly #viewportListeners = new Set<LayoutListener>();
  #selector: TargetSelector = null;
  #publishedSelector: TargetSelector = null;
  readonly #surfaceRestarts = new Set<() => void>();
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
    const mount = () => (this.#viewportRoot() ?? this.document.body).append(host);
    mount();
    this.document.addEventListener("fullscreenchange", mount);
    const stopClip =
      this.#pane && host instanceof this.window.HTMLElement ? this.#clipToPane(host) : null;
    return () => {
      this.document.removeEventListener("fullscreenchange", mount);
      stopClip?.();
      host.remove();
      if (this.#uiRoot === root) this.#uiRoot = null;
    };
  }

  // `#App` forms a stacking context below marimo's application chrome, so Lens
  // cannot paint above panels, dialogs, or menus from inside it. The clip keeps
  // fixed Lens UI inside the pane, or its fullscreen output in the top layer.
  #clipToPane(host: HTMLElement): () => void {
    const clip = () => {
      const pane = this.viewportBounds();
      // Every fixed Lens surface is placed in client coordinates, so the Lens
      // root sits at the client origin and pane client coordinates are its
      // insets. The host box can predate the shadow stylesheet on first mount.
      host.style.setProperty(
        "--marimo-lens-pane-clip",
        `inset(${pane.top}px calc(100% - ${pane.right}px) calc(100% - ${pane.bottom}px) ${pane.left}px)`,
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

  #viewportRoot(): HTMLElement | null {
    const fullscreen = this.document.fullscreenElement;
    return fullscreen instanceof this.window.HTMLElement &&
      (!this.#pane || containsOpenTree(this.#pane, fullscreen))
      ? fullscreen
      : this.#pane;
  }

  /** The visible fullscreen output, marimo's `#App` pane, or the visual viewport elsewhere. */
  viewportBounds(): ViewportBounds {
    const windowBounds = windowViewportBounds(this.window);
    const pane = this.#viewportRoot()?.getBoundingClientRect();
    if (!pane) return windowBounds;
    // A collapsed or offscreen pane leaves no area for Lens UI.
    return (
      intersectBounds(windowBounds, pane) ??
      new this.window.DOMRect(windowBounds.left, windowBounds.top, 0, 0)
    );
  }

  /**
   * The area Lens lays out its dock and surfaces in: the viewport bounds below
   * marimo's top-right controls and left of its bottom-right control column.
   * Those controls render outside the `#App` pane that Lens paints in, so they
   * would cover Lens UI beneath them.
   */
  layoutBounds(): ViewportBounds {
    const bounds = this.viewportBounds();
    if (!this.#pane || this.#viewportRoot() !== this.#pane) return bounds;
    let { left, top, right, bottom } = bounds;
    const column = this.#controls(MARIMO_COLUMN_SELECTOR, bounds);
    if (column) right = Math.max(left, column.left - CONTROLS_GAP);
    const row = this.#controls(MARIMO_ROW_SELECTOR, bounds);
    if (row) top = Math.min(bottom, row.bottom + CONTROLS_GAP);
    return new this.window.DOMRect(left, top, right - left, bottom - top);
  }

  #controls(selector: string, bounds: ViewportBounds): DOMRect | null {
    const rect = this.document.querySelector(selector)?.getBoundingClientRect();
    return rect &&
      rect.width > 0 &&
      rect.left < bounds.right &&
      rect.right > bounds.left &&
      rect.top < bounds.bottom &&
      rect.bottom > bounds.top
      ? rect
      : null;
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

  /**
   * Resolve targets with `selector`. The Lens sets it while it renders, so the
   * views and effects of that render resolve targets with it, and publishes it
   * once the render commits.
   */
  setSelector(selector: TargetSelector): void {
    if (this.#selector === selector) return;
    validateTargetSelector(this.document, selector);
    this.#selector = selector;
  }

  /** Refresh layout listeners and interaction surfaces after the selector changed. */
  publishSelector(): void {
    if (this.#publishedSelector === this.#selector) return;
    this.#publishedSelector = this.#selector;
    for (const restart of this.#surfaceRestarts) restart();
    this.#publishLayout();
  }

  targetFromEvent(event: Event): TargetSurface | null {
    const surface = targetFromEvent(event, this.#selector);
    return surface && this.#visibleInFullscreen(surface.element) ? surface : null;
  }

  targetFromElement(element: Element | null): TargetSurface | null {
    const surface = targetFromElement(element, this.#selector);
    return surface && this.#visibleInFullscreen(surface.element) ? surface : null;
  }

  captureContext(element: HTMLElement): HTMLElement | "auto" {
    const context = element.closest<HTMLElement>(`[${CAPTURE_CONTEXT_ATTRIBUTE}]`);
    if (!context) return "auto";
    return context === this.document.body || context === this.document.documentElement
      ? element
      : context;
  }

  getTarget(target: SelectionTarget): TargetSurface | null {
    const surface = getTargetSurface(this.document, target, this.#selector);
    return surface && this.#visibleInFullscreen(surface.element) ? surface : null;
  }

  listTargets(): TargetSurface[] {
    return listTargetSurfaces(this.document, this.#selector).filter(({ element }) =>
      this.#visibleInFullscreen(element),
    );
  }

  #visibleInFullscreen(element: Element): boolean {
    const fullscreen = this.document.fullscreenElement;
    return !fullscreen || containsOpenTree(fullscreen, element);
  }

  contentRevision(target: HTMLElement): number {
    // Geometry-only updates retain the descendant chosen for a scroll attachment.
    return this.#contentRevisions.get(target) ?? 0;
  }

  getOutputCell(outputCellId: string): OutputCell | null {
    const cell = getOutputCell(this.document, outputCellId);
    return cell && this.#visibleInFullscreen(cell.element) ? cell : null;
  }

  getCell(cellId: string): HTMLElement | null {
    const element = this.document.getElementById(`cell-${cellId}`);
    return element instanceof this.window.HTMLElement && this.#visibleInFullscreen(element)
      ? element
      : null;
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
    options: Omit<InteractionSurfaceOptions, "targetRoots">,
    attach: (surface: InteractionSurface) => () => void,
  ): () => void {
    const observe = () =>
      observeInteractionSurfaces(
        this.document,
        { ...options, targetRoots: () => this.listTargets().map(({ element }) => element) },
        attach,
      );
    let stop = observe();
    // A new selector changes which targets, and so which frames, carry surfaces.
    const restart = () => {
      stop();
      stop = observe();
    };
    this.#surfaceRestarts.add(restart);
    return () => {
      this.#surfaceRestarts.delete(restart);
      stop();
    };
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

  #publishLayout(): void {
    for (const listener of this.#layoutListeners) listener();
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
        this.#publishLayout();
      });
    };
    const scheduleTopology = () => {
      topologyDirty = true;
      schedule();
    };

    // The viewport subscription publishes the geometry change.
    const resized = () => invalidateContent();
    const scrolled = (event: Event) => {
      if (event.target instanceof this.window.Element) invalidateContent([event.target]);
      schedule();
    };
    this.window.addEventListener("resize", resized);
    this.window.addEventListener("scroll", scrolled, true);
    // Pane geometry moves every target without changing target content. A
    // pending layout frame already publishes the change.
    const stopViewport = this.subscribeViewport(() => {
      if (!frame) this.#publishLayout();
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
    // An added or removed subtree changes the target topology only when it
    // holds an output, a target, a scope, an outputless cell, or an open
    // shadow root. Editor keystrokes and streamed rows hold none of them.
    const holdsTopology = (node: Node): boolean => {
      if (!(node instanceof this.window.Element)) return false;
      const selector = this.#selector
        ? `${TOPOLOGY_SELECTOR}, ${this.#selector}`
        : TOPOLOGY_SELECTOR;
      return (
        node.matches(selector) ||
        node.querySelector(selector) !== null ||
        inDomRegion(node) ||
        node.shadowRoot !== null ||
        someOpenTreeElement(node, (element) => element.shadowRoot !== null)
      );
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
    const mutationObserver = new this.window.MutationObserver((records) => {
      records = records.filter((record) => record.target.getRootNode() !== this.#uiRoot);
      if (records.length === 0) return;
      let currentTargets: HTMLElement[] | null = null;
      const affectsTargets = records.some((record) => {
        if (record.type !== "attributes") return true;
        if (TARGET_ATTRIBUTES.has(record.attributeName ?? "")) return true;
        const target = record.target;
        if (!(target instanceof this.window.HTMLElement)) return false;
        if (target.closest("[data-marimo-lens-ui]")) return false;
        const related = (root: HTMLElement) =>
          containsOpenTree(root, target) || containsOpenTree(target, root);
        if ([...observedOutputs].some(related)) return true;
        if (this.#selector === null && !inDomRegion(target)) return false;
        currentTargets ??= this.listTargets().map(({ element }) => element);
        return currentTargets.some(related);
      });
      if (!affectsTargets) return;
      invalidateContent(records.map(({ target }) => target));
      const topologyChanged = records.some(
        (record) =>
          (record.type === "attributes" &&
            (this.#selector !== null ||
              inDomRegion(record.target) ||
              TARGET_ATTRIBUTES.has(record.attributeName ?? ""))) ||
          [...record.addedNodes, ...record.removedNodes].some(holdsTopology),
      );
      if (topologyChanged) scheduleTopology();
      else schedule();
    });
    const mutationOptions = {
      attributes: true,
      childList: true,
      subtree: true,
    } satisfies MutationObserverInit;
    const resizeObserver = new this.window.ResizeObserver((entries) => {
      invalidateContent(entries.map(({ target }) => target));
      schedule();
    });
    const syncTopology = () => {
      const outputs = new Set([
        ...listOutputRoots(this.document).map((output) => output.element),
        ...this.listTargets().map((target) => target.element),
      ]);
      for (const output of observedOutputs) {
        if (outputs.has(output)) continue;
        resizeObserver.unobserve(output);
        observedOutputs.delete(output);
      }
      for (const output of outputs) {
        if (observedOutputs.has(output)) continue;
        observedOutputs.add(output);
        this.#contentRevisions.set(output, this.#contentRevision);
        resizeObserver.observe(output);
      }

      const shadows = new Set(scanOpenTree(this.document.body).shadows);
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
        mutationObserver.disconnect();
        mutationObserver.observe(this.document.body, mutationOptions);
        for (const shadow of observedShadows) mutationObserver.observe(shadow, mutationOptions);
      } else {
        for (const shadow of addedShadows) mutationObserver.observe(shadow, mutationOptions);
      }
    };
    resizeObserver.observe(this.document.body);
    mutationObserver.observe(this.document.body, mutationOptions);
    syncTopology();

    return () => {
      if (frame) this.window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      for (const shadow of observedShadows) shadow.removeEventListener("scroll", scrolled, true);
      stopViewport();
      this.window.removeEventListener("resize", resized);
      this.window.removeEventListener("scroll", scrolled, true);
    };
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
    const observer = new this.window.ResizeObserver(schedule);
    if (pane) observer.observe(pane);
    this.document.addEventListener("fullscreenchange", schedule);
    this.window.addEventListener("resize", schedule);
    this.window.visualViewport?.addEventListener("resize", schedule);
    this.window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) this.window.cancelAnimationFrame(frame);
      observer.disconnect();
      this.document.removeEventListener("fullscreenchange", schedule);
      this.window.removeEventListener("resize", schedule);
      this.window.visualViewport?.removeEventListener("resize", schedule);
      this.window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }
}
