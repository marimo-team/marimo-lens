import type {
  AttentionActivityStartEvent,
  AttentionActivityStopEvent,
  AttentionRevealEvent,
  Trail,
} from "@marimo-lens/protocol";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

const ACTIVITY_EXIT_MS = 120;
const REVEAL_EXIT_MS = 180;
const FRAMING_SETTLE_MS = 600;
export const TARGET_ATTENTION_TOP_GUTTER = 48;

export type TargetAttentionKind = "activity" | "reveal";
type TargetAttentionPhase = "active" | "exiting";

export type TargetLocator = {
  kind: "cell" | "selection";
  label: string;
  resolve: () => HTMLElement | null;
};

export type TargetAttentionPresentation = {
  sequence: number;
  locator: TargetLocator;
  kind: TargetAttentionKind;
  target: HTMLElement | null;
  expiresAt: number | null;
  framing: "pending" | "settled";
  phase: TargetAttentionPhase;
  label: string | null;
  message: string | null;
  trail?: TrailNavigation;
};

export type TrailNavigation = {
  id: string;
  index: number;
  count: number;
  previous: () => void;
  next: () => void;
  close: () => void;
};

type ActiveTrail = {
  route: Trail;
  locators: TargetLocator[];
  index: number;
  expiresAt: number | null;
};

type ActiveAttention = TargetAttentionPresentation & {
  activityId: string | null;
  exitDuration: number;
  framingTimeout: number;
  observedTarget: HTMLElement | null;
  observedTargetSize: ElementSize | null;
  reframeAfterPending: boolean;
  revealFramed: boolean;
  resizeObserver: ResizeObserver | null;
  timeout: number;
  visibilityListener: () => void;
};

type AttentionRequest = {
  kind: TargetAttentionKind;
  activityId: string | null;
  durationMs: number | null;
  label: string | null;
  message: string | null;
};

type ElementSize = {
  width: number;
  height: number;
};

export class TargetAttentionController {
  readonly #dom: NotebookDomAdapter;
  readonly #onChange: (presentation: TargetAttentionPresentation | null) => void;
  #active: ActiveAttention | null = null;
  #sequence = 0;
  #trail: ActiveTrail | null = null;
  #stopLayout: (() => void) | null = null;
  #cancelScroll: (() => void) | null = null;

  constructor(
    dom: NotebookDomAdapter,
    onChange: (presentation: TargetAttentionPresentation | null) => void,
  ) {
    this.#dom = dom;
    this.#onChange = onChange;
  }

  startActivity(event: AttentionActivityStartEvent, locator: TargetLocator): void {
    this.#trail = null;
    this.#start(
      {
        kind: "activity",
        activityId: event.payload.activityId,
        durationMs: event.payload.durationMs ?? null,
        label: event.payload.label ?? null,
        message: event.payload.message ?? null,
      },
      locator,
    );
  }

  reveal(event: AttentionRevealEvent, locators: TargetLocator[]): void {
    const route = event.payload;
    this.#trail = {
      route,
      locators,
      index: 0,
      expiresAt:
        route.durationMs === undefined ? null : this.#now() + route.durationMs + REVEAL_EXIT_MS,
    };
    this.#showTrail(this.#trail);
  }

  stopActivity(event: AttentionActivityStopEvent): void {
    const active = this.#active;
    if (active?.kind === "activity" && active.activityId === event.payload.activityId) {
      this.#clear(true);
    }
  }

  endTrail(id?: string): void {
    if (!this.#trail || (id !== undefined && id !== this.#trail.route.id)) return;
    this.#trail = null;
    this.#clear(true);
  }

  #showTrail(trail: ActiveTrail): void {
    const step = trail.route.steps[trail.index]!;
    this.#start(
      {
        kind: "reveal",
        activityId: null,
        durationMs: null,
        label: step.label ?? null,
        message: step.message ?? null,
      },
      trail.locators[trail.index]!,
    );
  }

  #moveTrail(trail: ActiveTrail, delta: number): void {
    if (
      this.#trail !== trail ||
      (trail.expiresAt !== null && this.#now() >= trail.expiresAt - REVEAL_EXIT_MS)
    )
      return;
    const index = Math.max(0, Math.min(trail.route.steps.length - 1, trail.index + delta));
    if (index === trail.index) return;
    trail.index = index;
    this.#showTrail(trail);
  }

  dispose(): void {
    this.#trail = null;
    this.#clear(true);
  }

  #start(request: AttentionRequest, locator: TargetLocator): void {
    this.#clear(false);
    const target = locator.resolve();
    const frameRequested = this.#reframe(request.kind, target);

    const exitDuration = request.kind === "activity" ? ACTIVITY_EXIT_MS : REVEAL_EXIT_MS;
    const duration = request.durationMs;
    const expiresAt = this.#trail
      ? this.#trail.expiresAt
      : duration === null
        ? null
        : this.#now() + duration + exitDuration;
    const active: ActiveAttention = {
      ...request,
      sequence: ++this.#sequence,
      locator,
      target,
      expiresAt,
      exitDuration,
      framing: frameRequested ? "pending" : "settled",
      framingTimeout: 0,
      observedTarget: null,
      observedTargetSize: null,
      phase: "active",
      reframeAfterPending: false,
      revealFramed: request.kind === "reveal" && frameRequested,
      resizeObserver: null,
      timeout: 0,
      visibilityListener: () => this.#handleVisibility(active),
    };
    this.#active = active;
    this.#scheduleFraming(active);
    this.#observeTarget(active, target);
    this.#stopLayout ??= this.#dom.subscribeLayout(() => {
      if (this.#active) this.#refresh(this.#active);
    });
    this.#dom.document.addEventListener("visibilitychange", active.visibilityListener);
    this.#schedule(active);
    if (this.#active === active) this.#emit(active);
  }

  #refresh(active: ActiveAttention, reframe = false): void {
    if (this.#active !== active) return;
    if (active.expiresAt !== null && this.#now() >= active.expiresAt) {
      this.#clear(true);
      return;
    }
    const target = active.locator.resolve();
    const activityTargetChanged = target !== null && active.observedTarget !== target;
    active.target = target;
    // A scrolling Trail can enter the viewport before its caption fits. Keep
    // framing active so the stepper stays mounted through that top-edge gap.
    if (
      active.framing === "pending" &&
      !(this.#trail && this.#trail.route.steps.length > 1) &&
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

  #reframe(kind: TargetAttentionKind, target: HTMLElement | null): boolean {
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    if (kind !== "reveal" && isFullyVisible(this.#dom.window, rect)) {
      return false;
    }
    const viewportHeight = this.#dom.window.innerHeight;
    const distant = rect.bottom < -viewportHeight || rect.top > 2 * viewportHeight;
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior:
        (distant && (this.#trail?.route.steps.length ?? 0) < 2) ||
        prefersReducedMotion(this.#dom.window)
          ? "instant"
          : "smooth",
    });
    if (this.#trail) this.#cancelScroll = () => this.#dom.stopScroll(target);
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
      (this.#trail?.route.steps.length ?? 0) > 1 ? 2_000 : FRAMING_SETTLE_MS,
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
    const { sequence, locator, kind, target, expiresAt, framing, phase, label, message } = active;
    const trail = this.#trail;
    const presentation: TargetAttentionPresentation = {
      sequence,
      locator,
      kind,
      target,
      expiresAt,
      framing,
      phase,
      label,
      message,
    };
    if (trail && (trail.route.steps.length > 1 || trail.expiresAt === null)) {
      presentation.trail = {
        id: trail.route.id,
        index: trail.index,
        count: trail.route.steps.length,
        previous: () => this.#moveTrail(trail, -1),
        next: () => this.#moveTrail(trail, 1),
        close: () => {
          if (this.#trail === trail) this.endTrail();
        },
      };
    }
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
    this.#cancelScroll?.();
    this.#cancelScroll = null;
    this.#dom.window.clearTimeout(active.timeout);
    this.#dom.window.clearTimeout(active.framingTimeout);
    active.resizeObserver?.disconnect();
    if (notify) {
      this.#trail = null;
      this.#stopLayout?.();
      this.#stopLayout = null;
    }
    this.#dom.document.removeEventListener("visibilitychange", active.visibilityListener);
    if (notify) this.#onChange(null);
  }

  #now(): number {
    return this.#dom.window.Date.now();
  }
}

export function cellAddressTarget(dom: NotebookDomAdapter, cellId: string): HTMLElement | null {
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
    rect.top >= TARGET_ATTENTION_TOP_GUTTER &&
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
