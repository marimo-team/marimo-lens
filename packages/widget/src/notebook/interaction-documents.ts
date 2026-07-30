import type { OutputCell, ViewportPoint } from "@/notebook/types";

import { isOutputRoot, outputCellFromElement, outputCellFromRoot } from "@/notebook/output-root";

export type InteractionSurface = {
  document: Document;
  frame: HTMLIFrameElement | null;
};

export type InteractionSurfaceOptions = {
  includeOutputFrames: boolean;
  lockSelectionGestures: boolean;
};

export function observeInteractionSurfaces(
  ownerDocument: Document,
  options: InteractionSurfaceOptions,
  attach: (surface: InteractionSurface) => () => void,
): () => void {
  if (!options.includeOutputFrames) return attach({ document: ownerDocument, frame: null });

  const attached = new Map<Document, () => void>();
  const boundaries = new Set<HTMLIFrameElement>();
  const frameLoadListeners = new Set<HTMLIFrameElement>();
  const pointerEventLocks = new Map<HTMLElement, InlineStyleValue>();
  const touchActionLocks = new Map<HTMLElement, InlineStyleValue>();
  const observedRoots = new Set<Node>();
  const ownerWindow = requireOwnerWindow(ownerDocument);
  const observer = new ownerWindow.MutationObserver(() => scheduleRefresh());
  let refreshFrame = 0;
  let disposed = false;

  function scheduleRefresh() {
    if (disposed || refreshFrame) return;
    refreshFrame = ownerWindow.requestAnimationFrame(() => {
      refreshFrame = 0;
      refresh();
    });
  }

  function observeRoot(root: Node) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  function syncObservedRoots(currentRoots: Set<Node>) {
    const removed = [...observedRoots].some((root) => !currentRoots.has(root));
    if (removed) {
      observer.disconnect();
      observedRoots.clear();
    }
    for (const root of currentRoots) observeRoot(root);
  }

  function refresh() {
    if (disposed) return;
    const scan = scanOpenTree(ownerDocument);
    const frames = scan.frames.filter((frame) => outputCellFromElement(frame) !== null);
    const surfaces = discoverInteractionSurfaces(ownerDocument, frames);
    const currentDocuments = new Set(surfaces.map((surface) => surface.document));
    for (const [surfaceDocument, detach] of attached) {
      if (currentDocuments.has(surfaceDocument)) continue;
      detach();
      attached.delete(surfaceDocument);
    }
    for (const surface of surfaces) {
      if (!attached.has(surface.document)) attached.set(surface.document, attach(surface));
    }

    const currentFrames = new Set(frames);
    const boundaryFrames = options.lockSelectionGestures
      ? frames.filter((frame) => !frameDocument(frame))
      : [];
    const currentBoundaries = new Set(boundaryFrames);
    for (const frame of boundaries) {
      if (currentBoundaries.has(frame)) continue;
      delete frame.dataset.marimoLensPointerBoundary;
      boundaries.delete(frame);
    }
    for (const frame of boundaryFrames) {
      frame.dataset.marimoLensPointerBoundary = "true";
      boundaries.add(frame);
    }
    syncInlineStyleLocks(pointerEventLocks, new Set(boundaries), "pointer-events", "none");

    for (const frame of frameLoadListeners) {
      if (currentFrames.has(frame)) continue;
      frame.removeEventListener("load", scheduleRefresh);
      frameLoadListeners.delete(frame);
    }
    for (const frame of frames) {
      if (frameLoadListeners.has(frame)) continue;
      frame.addEventListener("load", scheduleRefresh);
      frameLoadListeners.add(frame);
    }

    const touchTargets = options.lockSelectionGestures
      ? new Set<HTMLElement>(scan.outputs)
      : new Set<HTMLElement>();
    if (options.lockSelectionGestures) {
      for (const surface of surfaces) {
        if (surface.frame) touchTargets.add(surface.document.documentElement);
      }
    }
    syncInlineStyleLocks(touchActionLocks, touchTargets, "touch-action", "none");

    syncObservedRoots(new Set<Node>([ownerDocument.body, ...scan.shadows]));
  }

  refresh();

  return () => {
    disposed = true;
    if (refreshFrame) ownerWindow.cancelAnimationFrame(refreshFrame);
    observer.disconnect();
    observedRoots.clear();
    for (const detach of attached.values()) detach();
    for (const frame of boundaries) delete frame.dataset.marimoLensPointerBoundary;
    for (const frame of frameLoadListeners) frame.removeEventListener("load", scheduleRefresh);
    syncInlineStyleLocks(pointerEventLocks, new Set(), "pointer-events", "none");
    syncInlineStyleLocks(touchActionLocks, new Set(), "touch-action", "none");
  };
}

export function parentViewportPoint(
  event: PointerEvent,
  frame: HTMLIFrameElement | null,
): ViewportPoint {
  if (!frame) return { x: event.clientX, y: event.clientY };
  const bounds = frame.getBoundingClientRect();
  const scaleX = frame.offsetWidth > 0 ? bounds.width / frame.offsetWidth : 1;
  const scaleY = frame.offsetHeight > 0 ? bounds.height / frame.offsetHeight : 1;
  return {
    x: bounds.left + (frame.clientLeft + event.clientX) * scaleX,
    y: bounds.top + (frame.clientTop + event.clientY) * scaleY,
  };
}

export function outputFromFrame(frame: HTMLIFrameElement): OutputCell | null {
  return outputCellFromElement(frame);
}

export function iframeAtPoint(point: ViewportPoint, output: OutputCell): HTMLIFrameElement | null {
  const frames = scanOpenTree(output.element).frames;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame) continue;
    const bounds = frame.getBoundingClientRect();
    if (
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    ) {
      return frame;
    }
  }
  return null;
}

function discoverInteractionSurfaces(
  ownerDocument: Document,
  frames: HTMLIFrameElement[],
): InteractionSurface[] {
  const surfaces: InteractionSurface[] = [{ document: ownerDocument, frame: null }];
  for (const frame of frames) {
    const childDocument = frameDocument(frame);
    if (childDocument) surfaces.push({ document: childDocument, frame });
  }
  return surfaces;
}

function scanOpenTree(root: ParentNode): {
  frames: HTMLIFrameElement[];
  shadows: ShadowRoot[];
  outputs: HTMLElement[];
} {
  const frames: HTMLIFrameElement[] = [];
  const shadows: ShadowRoot[] = [];
  const outputs: HTMLElement[] = [];
  const visit = (tree: ParentNode) => {
    for (const element of tree.querySelectorAll("*")) {
      if (isIFrameElement(element)) frames.push(element);
      if (isOutputRoot(element)) {
        const output = outputCellFromRoot(element);
        if (output) outputs.push(output.element);
      }
      if (!element.shadowRoot) continue;
      shadows.push(element.shadowRoot);
      visit(element.shadowRoot);
    }
  };
  visit(root);
  return { frames, shadows, outputs };
}

function isIFrameElement(element: Element): element is HTMLIFrameElement {
  return element instanceof requireOwnerWindow(element.ownerDocument).HTMLIFrameElement;
}

type InlineStyleValue = { value: string; priority: string };

function syncInlineStyleLocks(
  locks: Map<HTMLElement, InlineStyleValue>,
  current: Set<HTMLElement>,
  property: string,
  value: string,
): void {
  for (const [element, previous] of locks) {
    if (current.has(element)) continue;
    if (previous.value) {
      element.style.setProperty(property, previous.value, previous.priority);
    } else {
      element.style.removeProperty(property);
    }
    locks.delete(element);
  }
  for (const element of current) {
    if (locks.has(element)) continue;
    locks.set(element, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
    element.style.setProperty(property, value, "important");
  }
}

function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument?.documentElement ? frame.contentDocument : null;
  } catch {
    return null;
  }
}

function requireOwnerWindow(ownerDocument: Document): Window & typeof globalThis {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Lens interaction requires a browser window");
  return ownerWindow;
}
