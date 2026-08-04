import type { CellActivityEvent, CellAttentionEvent, CellRevealEvent } from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

const REVEAL_EXIT_MS = 180;

export type CellAttentionKind = "activity" | "reveal";
export type CellAttentionPhase = "active" | "exiting";

export type CellAttentionPresentation = {
  kind: CellAttentionKind;
  event: CellAttentionEvent;
  sequence: number;
  target: HTMLElement | null;
  expiresAt: number | null;
  phase: CellAttentionPhase;
};

type ActiveAttention = CellAttentionPresentation & {
  exitDuration: number;
  observedTarget: HTMLElement | null;
  resizeObserver: ResizeObserver | null;
  stopLayout: () => void;
  timeout: number;
  visibilityListener: () => void;
};

export class CellAttentionController {
  readonly #dom: NotebookDomAdapter;
  readonly #onChange: (presentation: CellAttentionPresentation | null) => void;
  #active: ActiveAttention | null = null;
  #sequence = 0;

  constructor(
    dom: NotebookDomAdapter,
    onChange: (presentation: CellAttentionPresentation | null) => void,
  ) {
    this.#dom = dom;
    this.#onChange = onChange;
  }

  activity(event: CellActivityEvent): void {
    const active = this.#active;
    if (active?.kind === "activity" && active.event.payload.cellId === event.payload.cellId) {
      this.#renewActivity(active, event);
      return;
    }
    this.#start("activity", event);
  }

  reveal(event: CellRevealEvent): void {
    this.#start("reveal", event);
  }

  finishActivity(resolutionRevision: number): void {
    const active = this.#active;
    if (active?.kind === "activity" && resolutionRevision >= active.event.revision) {
      this.#clear(true);
    }
  }

  dispose(): void {
    this.#clear(true);
  }

  #start(kind: CellAttentionKind, event: CellAttentionEvent): void {
    this.#clear(false);
    const target = attentionTarget(this.#dom, event.payload.cellId);
    if (kind === "reveal" && target) {
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: prefersReducedMotion(this.#dom.window) ? "auto" : "smooth",
      });
    }

    const revealDuration = event.type === "cell.reveal" ? event.payload.durationMs : 0;
    const expiresAt = kind === "activity" ? null : this.#now() + revealDuration + REVEAL_EXIT_MS;
    const active: ActiveAttention = {
      kind,
      event,
      sequence: ++this.#sequence,
      target,
      expiresAt,
      exitDuration: REVEAL_EXIT_MS,
      observedTarget: null,
      phase: "active",
      resizeObserver: null,
      stopLayout: () => undefined,
      timeout: 0,
      visibilityListener: () => this.#handleVisibility(active),
    };
    this.#active = active;
    this.#observeTarget(active, target);
    active.stopLayout = this.#dom.subscribeLayout(() => this.#refresh(active));
    this.#dom.document.addEventListener("visibilitychange", active.visibilityListener);
    this.#schedule(active);
    this.#emit(active);
  }

  #renewActivity(active: ActiveAttention, event: CellActivityEvent): void {
    const previous = active.event as CellActivityEvent;
    const samePresentation =
      previous.payload.label === event.payload.label &&
      previous.payload.message === event.payload.message;
    const target = attentionTarget(this.#dom, event.payload.cellId);
    active.event = event;
    active.target = target;
    this.#observeTarget(active, target);
    active.phase = "active";
    if (!samePresentation) active.sequence = ++this.#sequence;
    this.#emit(active);
  }

  #refresh(active: ActiveAttention): void {
    if (this.#active !== active) return;
    if (active.expiresAt !== null && this.#now() >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    const target = attentionTarget(this.#dom, active.event.payload.cellId);
    active.target = target;
    this.#observeTarget(active, target);
    this.#emit(active);
  }

  #handleVisibility(active: ActiveAttention): void {
    if (this.#active !== active || this.#dom.document.visibilityState === "hidden") return;
    if (active.expiresAt !== null && this.#now() >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    this.#schedule(active);
    this.#refresh(active);
  }

  #schedule(active: ActiveAttention): void {
    this.#dom.window.clearTimeout(active.timeout);
    if (active.expiresAt === null) return;
    const now = this.#now();
    if (now >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    const nextAt =
      active.phase === "active" ? active.expiresAt - active.exitDuration : active.expiresAt;
    active.timeout = this.#dom.window.setTimeout(
      () => this.#advance(active),
      Math.max(0, nextAt - now),
    );
  }

  #advance(active: ActiveAttention): void {
    if (this.#active !== active) return;
    if (active.expiresAt === null) return;
    const now = this.#now();
    if (now >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    if (active.phase === "active" && now >= active.expiresAt - active.exitDuration) {
      active.phase = "exiting";
      this.#emit(active);
    }
    this.#schedule(active);
  }

  #emit(active: ActiveAttention): void {
    this.#onChange({
      kind: active.kind,
      event: active.event,
      sequence: active.sequence,
      target: active.target,
      expiresAt: active.expiresAt,
      phase: active.phase,
    });
  }

  #observeTarget(active: ActiveAttention, target: HTMLElement | null): void {
    if (active.observedTarget === target) return;
    active.resizeObserver?.disconnect();
    active.resizeObserver = null;
    active.observedTarget = target;
    const ResizeObserverClass = this.#dom.window.ResizeObserver;
    if (!target || !ResizeObserverClass) return;
    active.resizeObserver = new ResizeObserverClass(() => this.#refresh(active));
    active.resizeObserver.observe(target);
  }

  #clear(notify: boolean): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    this.#dom.window.clearTimeout(active.timeout);
    active.resizeObserver?.disconnect();
    active.stopLayout();
    this.#dom.document.removeEventListener("visibilitychange", active.visibilityListener);
    if (notify) this.#onChange(null);
  }

  #now(): number {
    return this.#dom.window.Date.now();
  }
}

function attentionTarget(dom: NotebookDomAdapter, cellId: string): HTMLElement | null {
  const cell = dom.getCell(cellId);
  if (cell && isRendered(dom.window, cell)) return cell;
  const output = dom.getOutputCell(cellId)?.element ?? null;
  return output && isRendered(dom.window, output) ? output : null;
}

function isRendered(ownerWindow: Window, element: HTMLElement): boolean {
  const style = ownerWindow.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    element.isConnected &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function prefersReducedMotion(ownerWindow: Window): boolean {
  return (
    typeof ownerWindow.matchMedia === "function" &&
    ownerWindow.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
