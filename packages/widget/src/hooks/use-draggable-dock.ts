import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { DockPosition } from "@/types";

import { clamp } from "@/lib/dom-geometry";
import { useLensUiStore } from "@/store";

const VIEWPORT_GUTTER = 12;
const KEYBOARD_STEP = 24;
const KEYBOARD_LARGE_STEP = 96;
const DRAG_CLICK_SUPPRESSION_MS = 160;
const DRAG_CLICK_THRESHOLD = 4;

type DockDragProps = HTMLAttributes<HTMLDivElement>;
type DockBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: DockPosition;
  bounds: DockBounds;
  position: DockPosition;
};

export function useDraggableDock(expanded: boolean): {
  dockRef: RefObject<HTMLDivElement | null>;
  dockStyle: CSSProperties | undefined;
  dockDragProps: DockDragProps;
  consumeDragClick: () => boolean;
} {
  const dockRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const didDragRef = useRef(false);
  const positionRef = useRef<DockPosition | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dockPosition = useLensUiStore((state) => state.dockPosition);
  const setDragging = useLensUiStore((state) => state.setDragging);
  const setDockPosition = useLensUiStore((state) => state.setDockPosition);

  useLayoutEffect(() => {
    const element = dockRef.current;
    positionRef.current = dockPosition;
    if (!element) return;
    if (dockPosition) {
      const clamped = clampPosition(dockPosition, boundsForElement(element));
      positionRef.current = clamped;
      applyDockPosition(element, clamped);
      if (clamped.x !== dockPosition.x || clamped.y !== dockPosition.y) {
        setDockPosition(clamped);
      }
      return;
    }
    clearDockPosition(element);
  }, [dockPosition, expanded, setDockPosition]);

  useEffect(() => {
    const element = dockRef.current;
    if (!element) return;

    const clampCurrentPosition = () => {
      const position = positionRef.current;
      if (!position) return;
      const clamped = clampPosition(position, boundsForElement(element));
      if (clamped.x !== position.x || clamped.y !== position.y) {
        positionRef.current = clamped;
        applyDockPosition(element, clamped);
        setDockPosition(clamped);
      }
    };

    clampCurrentPosition();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clampCurrentPosition);
    observer?.observe(element);
    window.addEventListener("resize", clampCurrentPosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", clampCurrentPosition);
    };
  }, [setDockPosition]);

  const currentPosition = useCallback((): DockPosition | null => {
    const element = dockRef.current;
    if (!element) return positionRef.current;
    const rect = element.getBoundingClientRect();
    return clampPosition(
      positionRef.current ?? { x: rect.left, y: rect.top },
      boundsForElement(element),
    );
  }, []);

  const moveBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const element = dockRef.current;
      if (!element) return;
      const origin = currentPosition();
      if (!origin) return;
      const position = clampPosition(
        { x: origin.x + deltaX, y: origin.y + deltaY },
        boundsForElement(element),
      );
      positionRef.current = position;
      applyDockPosition(element, position);
      setDockPosition(position);
    },
    [currentPosition, setDockPosition],
  );

  const commitDragPosition = useCallback(
    (position: DockPosition) => {
      const element = dockRef.current;
      const finalPosition = element ? currentVisualPosition(element) : position;
      positionRef.current = finalPosition;
      if (element) {
        applyDockPosition(element, finalPosition);
        element.style.transform = "";
        clearDragStyles(element);
      }
      setDockPosition(finalPosition);
    },
    [setDockPosition],
  );

  const restoreRestingPosition = useCallback(() => {
    const element = dockRef.current;
    if (!element) return;
    element.style.transform = "";
    clearDragStyles(element);
    const position = positionRef.current;
    if (position) {
      applyDockPosition(element, position);
      return;
    }
    clearDockPosition(element);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const element = dockRef.current;
      if (!element) return;
      if (expanded && isToolbarControlTarget(event.target)) return;
      const origin = currentPosition();
      if (!origin) return;
      didDragRef.current = false;
      dragSessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        bounds: boundsForElement(element),
        position: origin,
      };
      applyDockPosition(element, origin);
      element.style.transform = "";
      prepareDragStyles(element);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentPosition, expanded],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      const position = clampPosition(
        { x: session.origin.x + deltaX, y: session.origin.y + deltaY },
        session.bounds,
      );
      session.position = position;
      const element = dockRef.current;
      if (element) applyDragTransform(element, session.origin, position);
      const wasDrag =
        Math.abs(deltaX) > DRAG_CLICK_THRESHOLD || Math.abs(deltaY) > DRAG_CLICK_THRESHOLD;
      if (wasDrag && !didDragRef.current) {
        didDragRef.current = true;
        setDragging(true);
      }
      if (wasDrag) event.preventDefault();
    },
    [setDragging],
  );

  const endPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (didDragRef.current && !cancelled) {
        commitDragPosition(session.position);
        setDragging(false);
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, DRAG_CLICK_SUPPRESSION_MS);
      } else {
        restoreRestingPosition();
      }
      didDragRef.current = false;
      dragSessionRef.current = null;
    },
    [commitDragPosition, restoreRestingPosition, setDragging],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => endPointerDrag(event, false),
    [endPointerDrag],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => endPointerDrag(event, true),
    [endPointerDrag],
  );

  const consumeDragClick = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
      const moves: Record<string, [number, number]> = {
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
      };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        moveBy(move[0], move[1]);
        return;
      }
    },
    [moveBy],
  );

  const dockStyle = dockPosition
    ? ({ left: dockPosition.x, top: dockPosition.y } satisfies CSSProperties)
    : undefined;

  return {
    dockRef,
    dockStyle,
    dockDragProps: {
      onKeyDown,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
    consumeDragClick,
  };
}

function boundsForElement(element: HTMLElement): DockBounds {
  const frame = element.getBoundingClientRect();
  const visible = visibleToolbarRect(element) ?? frame;
  const offsetX = visible.left - frame.left;
  const offsetY = visible.top - frame.top;
  const left = VIEWPORT_GUTTER - offsetX;
  const top = VIEWPORT_GUTTER - offsetY;
  const right = Math.max(left, window.innerWidth - VIEWPORT_GUTTER - offsetX - visible.width);
  const bottom = Math.max(top, window.innerHeight - VIEWPORT_GUTTER - offsetY - visible.height);
  return {
    left,
    top,
    right,
    bottom,
  };
}

function visibleToolbarRect(element: HTMLElement): DOMRect | null {
  return element.querySelector<HTMLElement>(".ml-toolbar")?.getBoundingClientRect() ?? null;
}

function isToolbarControlTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'button, input, select, textarea, a[href], [role="button"], [contenteditable="true"]',
    ) !== null
  );
}

function clampPosition(position: DockPosition, bounds: DockBounds): DockPosition {
  return {
    x: clamp(position.x, bounds.left, bounds.right),
    y: clamp(position.y, bounds.top, bounds.bottom),
  };
}

function applyDockPosition(element: HTMLElement, position: DockPosition): void {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
}

function clearDockPosition(element: HTMLElement): void {
  element.style.left = "";
  element.style.top = "";
  element.style.right = "";
  element.style.bottom = "";
  element.style.transform = "";
}

function prepareDragStyles(element: HTMLElement): void {
  element.style.transition = "none";
  element.style.willChange = "transform";
}

function clearDragStyles(element: HTMLElement): void {
  element.style.transition = "";
  element.style.willChange = "";
}

function currentVisualPosition(element: HTMLElement): DockPosition {
  const rect = element.getBoundingClientRect();
  return clampPosition({ x: rect.left, y: rect.top }, boundsForElement(element));
}

function applyDragTransform(
  element: HTMLElement,
  origin: DockPosition,
  position: DockPosition,
): void {
  element.style.transform = `translate3d(${position.x - origin.x}px, ${
    position.y - origin.y
  }px, 0)`;
}
