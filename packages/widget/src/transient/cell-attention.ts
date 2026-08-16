import type {
  CellActivityStartEvent,
  CellActivityStopEvent,
  CellRevealEvent,
} from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

const ACTIVITY_EXIT_MS = 120;
const REVEAL_EXIT_MS = 180;
const FRAMING_SETTLE_MS = 600;
export const CELL_ATTENTION_TOP_GUTTER = 48;

export type CellAttentionKind = "activity" | "reveal";
export type CellAttentionPhase = "active" | "exiting";

type CellAttentionPresentationState = {
  sequence: number;
  target: HTMLElement | null;
  expiresAt: number | null;
  framing: "pending" | "settled";
  phase: CellAttentionPhase;
};

type ActivityAttentionPresentation = CellAttentionPresentationState & {
  kind: "activity";
  event: CellActivityStartEvent;
};

type RevealAttentionPresentation = CellAttentionPresentationState & {
  kind: "reveal";
  event: CellRevealEvent;
};

export type CellAttentionPresentation = ActivityAttentionPresentation | RevealAttentionPresentation;

type ActiveAttention = CellAttentionPresentation & {
  exitDuration: number;
  framingTimeout: number;
  observedTarget: HTMLElement | null;
  observedTargetSize: ElementSize | null;
  reframeAfterPending: boolean;
  revealFramed: boolean;
  resizeObserver: ResizeObserver | null;
  stopLayout: () => void;
  timeout: number;
  visibilityListener: () => void;
};

type ActiveActivityAttention = ActiveAttention & {
  kind: "activity";
  event: CellActivityStartEvent;
};

type AttentionStart =
  | { kind: "activity"; event: CellActivityStartEvent }
  | { kind: "reveal"; event: CellRevealEvent };

type ElementSize = {
  width: number;
  height: number;
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

  startActivity(event: CellActivityStartEvent): void {
    const active = this.#active;
    if (active?.kind === "activity" && active.event.payload.cellId === event.payload.cellId) {
      this.#renewActivity(active, event);
      return;
    }
    this.#start({ kind: "activity", event });
  }

  reveal(event: CellRevealEvent): void {
    this.#start({ kind: "reveal", event });
  }

  stopActivity(event: CellActivityStopEvent): void {
    const active = this.#active;
    if (active?.kind === "activity" && active.event.payload.cellId === event.payload.cellId) {
      this.#clear(true);
    }
  }

  dispose(): void {
    this.#clear(true);
  }

  #start(start: AttentionStart): void {
    this.#clear(false);
    const target = attentionTarget(this.#dom, start.event.payload.cellId);
    const frameRequested = this.#reframe(start.kind, target);

    const exitDuration = start.kind === "activity" ? ACTIVITY_EXIT_MS : REVEAL_EXIT_MS;
    const duration = start.event.payload.durationMs ?? null;
    const expiresAt = duration === null ? null : this.#now() + duration + exitDuration;
    const active: ActiveAttention = {
      ...start,
      sequence: ++this.#sequence,
      target,
      expiresAt,
      exitDuration,
      framing: frameRequested ? "pending" : "settled",
      framingTimeout: 0,
      observedTarget: null,
      observedTargetSize: null,
      phase: "active",
      reframeAfterPending: false,
      revealFramed: start.kind === "reveal" && frameRequested,
      resizeObserver: null,
      stopLayout: () => undefined,
      timeout: 0,
      visibilityListener: () => this.#handleVisibility(active),
    };
    this.#active = active;
    this.#scheduleFraming(active);
    this.#observeTarget(active, target);
    active.stopLayout = this.#dom.subscribeLayout(() => this.#refresh(active));
    this.#dom.document.addEventListener("visibilitychange", active.visibilityListener);
    this.#schedule(active);
    this.#emit(active);
  }

  #renewActivity(active: ActiveActivityAttention, event: CellActivityStartEvent): void {
    const previous = active.event;
    const samePresentation =
      previous.payload.label === event.payload.label &&
      previous.payload.message === event.payload.message;
    const target = attentionTarget(this.#dom, event.payload.cellId);
    active.event = event;
    active.target = target;
    if (active.framing === "settled") this.#beginFraming(active, target);
    this.#observeTarget(active, target);
    active.phase = "active";
    active.expiresAt =
      event.payload.durationMs === undefined
        ? null
        : this.#now() + event.payload.durationMs + active.exitDuration;
    if (!samePresentation) active.sequence = ++this.#sequence;
    this.#schedule(active);
    this.#emit(active);
  }

  #refresh(active: ActiveAttention, reframe = false): void {
    if (this.#active !== active) return;
    if (active.expiresAt !== null && this.#now() >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    const target = attentionTarget(this.#dom, active.event.payload.cellId);
    const activityTargetChanged = target !== null && active.observedTarget !== target;
    active.target = target;
    if (
      active.framing === "pending" &&
      target !== null &&
      isFullyVisible(this.#dom.window, target.getBoundingClientRect())
    ) {
      this.#finishFraming(active);
    }
    if (active.kind === "activity" && activityTargetChanged) {
      this.#beginFraming(active, target);
    } else if (active.kind === "activity" && reframe) {
      if (active.framing === "pending") active.reframeAfterPending = true;
      else this.#beginFraming(active, target);
    } else if (active.kind === "reveal" && !active.revealFramed && target !== null) {
      active.revealFramed = this.#beginFraming(active, target);
    }
    this.#observeTarget(active, target);
    this.#emit(active);
  }

  #reframe(kind: CellAttentionKind, target: HTMLElement | null): boolean {
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    if (kind !== "reveal" && isFullyVisible(this.#dom.window, rect)) {
      return false;
    }
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: prefersReducedMotion(this.#dom.window) ? "auto" : "smooth",
    });
    return true;
  }

  #beginFraming(active: ActiveAttention, target: HTMLElement | null): boolean {
    const requested = this.#reframe(active.kind, target);
    if (!requested) return false;
    active.framing = "pending";
    active.reframeAfterPending = false;
    this.#scheduleFraming(active);
    return true;
  }

  #scheduleFraming(active: ActiveAttention): void {
    this.#dom.window.clearTimeout(active.framingTimeout);
    if (active.framing !== "pending") return;
    active.framingTimeout = this.#dom.window.setTimeout(
      () => this.#settleFraming(active),
      FRAMING_SETTLE_MS,
    );
  }

  #settleFraming(active: ActiveAttention): void {
    if (this.#active !== active || active.framing !== "pending") return;
    const reframe = active.kind === "activity" && active.reframeAfterPending;
    this.#finishFraming(active);
    this.#refresh(active, reframe);
  }

  #finishFraming(active: ActiveAttention): void {
    this.#dom.window.clearTimeout(active.framingTimeout);
    active.framingTimeout = 0;
    active.framing = "settled";
    active.reframeAfterPending = false;
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
    const state: CellAttentionPresentationState = {
      sequence: active.sequence,
      target: active.target,
      expiresAt: active.expiresAt,
      framing: active.framing,
      phase: active.phase,
    };
    const presentation: CellAttentionPresentation =
      active.kind === "activity"
        ? { ...state, kind: "activity", event: active.event }
        : { ...state, kind: "reveal", event: active.event };
    this.#onChange(presentation);
  }

  #observeTarget(active: ActiveAttention, target: HTMLElement | null): void {
    if (active.observedTarget === target) return;
    active.resizeObserver?.disconnect();
    active.resizeObserver = null;
    active.observedTarget = target;
    active.observedTargetSize = target ? targetSize(target) : null;
    const ResizeObserverClass = this.#dom.window.ResizeObserver;
    if (!target || !ResizeObserverClass) return;
    active.resizeObserver = new ResizeObserverClass(() => {
      if (this.#active !== active || active.observedTarget !== target) return;
      const size = targetSize(target);
      const changed = !sameSize(active.observedTargetSize, size);
      active.observedTargetSize = size;
      this.#refresh(active, changed);
    });
    active.resizeObserver.observe(target);
  }

  #clear(notify: boolean): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    this.#dom.window.clearTimeout(active.timeout);
    this.#dom.window.clearTimeout(active.framingTimeout);
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

function isFullyVisible(ownerWindow: Window, rect: DOMRect): boolean {
  return (
    rect.top >= CELL_ATTENTION_TOP_GUTTER &&
    rect.bottom <= ownerWindow.innerHeight &&
    rect.left >= 0 &&
    rect.right <= ownerWindow.innerWidth
  );
}

function targetSize(target: HTMLElement): ElementSize {
  const rect = target.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function sameSize(left: ElementSize | null, right: ElementSize): boolean {
  return left?.width === right.width && left.height === right.height;
}

function prefersReducedMotion(ownerWindow: Window): boolean {
  return ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
