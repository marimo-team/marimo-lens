import { useDrag } from "@use-gesture/react";
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type HTMLAttributes,
  type RefObject,
} from "react";

import type { DockPosition } from "@/types";

import { clamp } from "@/lib/dom-geometry";
import { useLensUiStore } from "@/store";

const VIEWPORT_GUTTER = 12;
const RIGHT_ALIGNED_OPEN_FOOTPRINT = 340;
const KEYBOARD_STEP = 24;
const KEYBOARD_LARGE_STEP = 96;
const DRAG_CLICK_SUPPRESSION_MS = 160;
const DRAG_CLICK_THRESHOLD = 4;

type DockDragProps = HTMLAttributes<HTMLDivElement>;

export function useDraggableDock(): {
  dockRef: RefObject<HTMLDivElement | null>;
  dockStyle: CSSProperties | undefined;
  dockDragProps: DockDragProps;
  consumeDragClick: () => boolean;
} {
  const dockRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const didDragRef = useRef(false);
  const dockPosition = useLensUiStore((state) => state.dockPosition);
  const setDragging = useLensUiStore((state) => state.setDragging);
  const setDockPosition = useLensUiStore((state) => state.setDockPosition);
  const resetDockPosition = useLensUiStore((state) => state.resetDockPosition);

  useEffect(() => {
    if (!dockPosition) return;
    const element = dockRef.current;
    if (!element) return;

    const clampCurrentPosition = () => {
      const clamped = clampPosition(dockPosition, element.getBoundingClientRect());
      if (clamped.x !== dockPosition.x || clamped.y !== dockPosition.y) {
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
  }, [dockPosition, setDockPosition]);

  const currentPosition = useCallback((): DockPosition | null => {
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return dockPosition;
    return clampPosition(dockPosition ?? { x: rect.left, y: rect.top }, rect);
  }, [dockPosition]);

  const dragBounds = useCallback(() => {
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) {
      return {
        left: VIEWPORT_GUTTER,
        top: VIEWPORT_GUTTER,
        right: window.innerWidth - VIEWPORT_GUTTER,
        bottom: window.innerHeight - VIEWPORT_GUTTER,
      };
    }
    return boundsForRect(rect);
  }, []);

  const moveBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const rect = dockRef.current?.getBoundingClientRect();
      if (!rect) return;
      const origin = currentPosition();
      if (!origin) return;
      setDockPosition(clampPosition({ x: origin.x + deltaX, y: origin.y + deltaY }, rect));
    },
    [currentPosition, setDockPosition],
  );

  const bindDrag = useDrag(
    ({ first, last, movement, offset }) => {
      if (first) didDragRef.current = false;
      const wasDrag =
        Math.abs(movement[0]) > DRAG_CLICK_THRESHOLD ||
        Math.abs(movement[1]) > DRAG_CLICK_THRESHOLD;
      const position = { x: offset[0], y: offset[1] };
      if (wasDrag) {
        if (!didDragRef.current) {
          didDragRef.current = true;
          setDragging(true);
        }
        setDockPosition(position, { persist: last });
      }
      if (last) {
        if (didDragRef.current) {
          setDragging(false);
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, DRAG_CLICK_SUPPRESSION_MS);
        }
        didDragRef.current = false;
      }
    },
    {
      bounds: dragBounds,
      eventOptions: { passive: false },
      filterTaps: true,
      from: () => {
        const position = currentPosition();
        return [position?.x ?? 0, position?.y ?? 0];
      },
      pointer: {
        capture: false,
        keys: false,
      },
      preventDefault: true,
    },
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
      if (event.key === "Home") {
        event.preventDefault();
        resetDockPosition();
      }
    },
    [moveBy, resetDockPosition],
  );

  const dockStyle = dockPosition
    ? ({ left: dockPosition.x, top: dockPosition.y } satisfies CSSProperties)
    : undefined;

  return {
    dockRef,
    dockStyle,
    dockDragProps: {
      ...bindDrag(),
      onDoubleClick: resetDockPosition,
      onKeyDown,
    },
    consumeDragClick,
  };
}

function boundsForRect(rect: DOMRect) {
  const footprintWidth = Math.max(
    rect.width,
    Math.min(RIGHT_ALIGNED_OPEN_FOOTPRINT, window.innerWidth - VIEWPORT_GUTTER * 2),
  );
  const left = VIEWPORT_GUTTER + Math.max(0, footprintWidth - rect.width);
  const right = Math.max(left, window.innerWidth - rect.width - VIEWPORT_GUTTER);
  return {
    left,
    top: VIEWPORT_GUTTER,
    right,
    bottom: Math.max(VIEWPORT_GUTTER, window.innerHeight - rect.height - VIEWPORT_GUTTER),
  };
}

function clampPosition(position: DockPosition, rect: DOMRect): DockPosition {
  const bounds = boundsForRect(rect);
  return {
    x: clamp(position.x, bounds.left, bounds.right),
    y: clamp(position.y, bounds.top, bounds.bottom),
  };
}
