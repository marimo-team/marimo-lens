import type { OutputCell, ViewportPoint } from "@/types";

import { listOutputCells, outputCellFromElement } from "@/capture/output-root";

export type InteractionSurface = {
  document: Document;
  frame: HTMLIFrameElement | null;
};

export function observeInteractionSurfaces(
  armed: boolean,
  attach: (surface: InteractionSurface) => () => void,
): () => void {
  if (!armed) return attach({ document, frame: null });

  const attached = new Map<Document, () => void>();
  const boundaries = new Set<HTMLIFrameElement>();
  const frameLoadListeners = new Set<HTMLIFrameElement>();
  const pointerEventLocks = new Map<HTMLElement, InlineStyleValue>();
  const touchActionLocks = new Map<HTMLElement, InlineStyleValue>();
  const observer = new MutationObserver(() => refresh());

  function refresh() {
    const scan = scanOpenTree(document);
    const frames = scan.frames.filter((frame) => outputCellFromElement(frame) !== null);
    const surfaces = discoverInteractionSurfaces(frames);
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
    for (const frame of boundaries) {
      if (!currentFrames.has(frame) || frameDocument(frame)) {
        delete frame.dataset.marimoLensPointerBoundary;
        boundaries.delete(frame);
      }
    }
    for (const frame of frames) {
      if (frameDocument(frame)) continue;
      frame.dataset.marimoLensPointerBoundary = "true";
      boundaries.add(frame);
    }
    syncInlineStyleLocks(pointerEventLocks, new Set(boundaries), "pointer-events", "none");

    for (const frame of frameLoadListeners) {
      if (currentFrames.has(frame)) continue;
      frame.removeEventListener("load", refresh);
      frameLoadListeners.delete(frame);
    }
    for (const frame of frames) {
      if (frameLoadListeners.has(frame)) continue;
      frame.addEventListener("load", refresh);
      frameLoadListeners.add(frame);
    }

    const touchTargets = new Set(listOutputCells().map((output) => output.element));
    for (const surface of surfaces) {
      if (surface.frame) touchTargets.add(surface.document.documentElement);
    }
    syncInlineStyleLocks(touchActionLocks, touchTargets, "touch-action", "none");

    observer.disconnect();
    observer.observe(document.body, { childList: true, subtree: true });
    for (const shadow of scan.shadows) {
      observer.observe(shadow, { childList: true, subtree: true });
    }
  }

  refresh();

  return () => {
    observer.disconnect();
    for (const detach of attached.values()) detach();
    for (const frame of boundaries) delete frame.dataset.marimoLensPointerBoundary;
    for (const frame of frameLoadListeners) frame.removeEventListener("load", refresh);
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
  const scaleX = bounds.width / Math.max(frame.offsetWidth, bounds.width, 1);
  const scaleY = bounds.height / Math.max(frame.offsetHeight, bounds.height, 1);
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

function discoverInteractionSurfaces(frames: HTMLIFrameElement[]): InteractionSurface[] {
  const surfaces: InteractionSurface[] = [{ document, frame: null }];
  for (const frame of frames) {
    const childDocument = frameDocument(frame);
    if (childDocument) surfaces.push({ document: childDocument, frame });
  }
  return surfaces;
}

function scanOpenTree(root: ParentNode): {
  frames: HTMLIFrameElement[];
  shadows: ShadowRoot[];
} {
  const frames: HTMLIFrameElement[] = [];
  const shadows: ShadowRoot[] = [];
  const visit = (tree: ParentNode) => {
    for (const element of tree.querySelectorAll("*")) {
      if (element instanceof HTMLIFrameElement) frames.push(element);
      if (!element.shadowRoot) continue;
      shadows.push(element.shadowRoot);
      visit(element.shadowRoot);
    }
  };
  visit(root);
  return { frames, shadows };
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
