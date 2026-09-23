import { useLayoutEffect, type RefObject } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { observeVisibleViewport } from "@/notebook/viewport";

const POSITION_KEY = "marimo-lens:dock-position:v1";
const DEFAULT_POSITION = { x: 0.5, y: 1 };
type Position = { x: number; y: number };
type Drag = {
  id: number;
  handle: HTMLElement;
  start: Position;
  origin: Position;
  previous: Position;
  moved: boolean;
};

// Position is a browser preference, independent of notebook and selection state.
export function useDockPosition(ref: RefObject<HTMLElement | null>) {
  const dom = useNotebookDom();
  useLayoutEffect(() => {
    const dock = ref.current;
    if (!dock) return;
    const win = dom.window;
    let position = readPosition(win);
    let point = { x: 0, y: 0 };
    let bounds = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
    let visibleBounds = bounds;
    let edge = 16;
    let width = 0;
    let height = 0;
    let frame = 0;
    let drag: Drag | null = null;
    let suppressClick = false;

    const travel = () => ({
      x: Math.max(0, bounds.right - bounds.left - width - edge * 2),
      y: Math.max(0, bounds.bottom - bounds.top - height - edge * 2),
    });
    const paint = () => {
      frame = 0;
      if (drag?.moved) {
        dock.style.transform = `translate3d(${point.x - drag.origin.x}px, ${point.y - drag.origin.y}px, 0)`;
      } else {
        dock.style.left = `${point.x}px`;
        dock.style.top = `${point.y}px`;
        dock.style.transform = "";
      }
      dock.style.setProperty("--ml-dock-x", `${point.x}px`);
      const above = point.y - bounds.top - edge - 8;
      const below = bounds.bottom - point.y - height - edge - 8;
      dock.dataset.placement = below > above ? "below" : "above";
      dock.style.setProperty("--ml-dock-space", `${Math.max(0, above, below)}px`);
      dock.dataset.panelOverlay = Math.max(above, below) < 200 ? "true" : "false";
      dock.style.setProperty("--ml-dock-panel-top", `${bounds.top + edge - point.y}px`);
    };
    const move = (next: Position, immediate = false) => {
      const range = travel();
      point = {
        x: Math.max(bounds.left + edge, Math.min(bounds.left + edge + range.x, next.x)),
        y: Math.max(bounds.top + edge, Math.min(bounds.top + edge + range.y, next.y)),
      };
      if (immediate) {
        if (frame) win.cancelAnimationFrame(frame);
        paint();
      } else if (!frame) frame = win.requestAnimationFrame(paint);
    };
    const save = () => {
      const range = travel();
      position = {
        x: range.x ? (point.x - bounds.left - edge) / range.x : position.x,
        y: range.y ? (point.y - bounds.top - edge) / range.y : position.y,
      };
      try {
        win.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch {
        // Storage may be disabled in an embedded notebook; movement still works.
      }
    };
    const layout = () => {
      const notebook = dom.viewportBounds();
      bounds = {
        left: Math.max(visibleBounds.left, notebook.left),
        top: Math.max(visibleBounds.top, notebook.top),
        right: Math.min(visibleBounds.right, notebook.right),
        bottom: Math.min(visibleBounds.bottom, notebook.bottom),
      };
      edge = win.innerWidth <= 640 ? 12 : 16;
      const safeBottom =
        Number.parseFloat(win.getComputedStyle(dock).getPropertyValue("--ml-safe-area-bottom")) ||
        0;
      bounds.bottom -= Math.max(0, safeBottom - edge);
      width = dock.offsetWidth;
      height = dock.offsetHeight;
      dock.style.setProperty("--ml-dock-viewport-left", `${bounds.left}px`);
      dock.style.setProperty("--ml-dock-viewport-right", `${bounds.right}px`);
      dock.style.setProperty("--ml-dock-viewport-width", `${bounds.right - bounds.left}px`);
      dock.style.setProperty(
        "--ml-dock-panel-height",
        `${Math.max(0, bounds.bottom - bounds.top - edge * 2)}px`,
      );
      if (!drag) {
        const range = travel();
        point = {
          x: bounds.left + edge + position.x * range.x,
          y: bounds.top + edge + position.y * range.y,
        };
      }
      move(point, true);
    };
    const finish = (cancelled: boolean) => {
      if (!drag) return;
      const ended = drag;
      drag = null;
      dock.removeAttribute("data-dragging");
      if (ended.moved) {
        suppressClick = true;
        if (cancelled) {
          position = ended.previous;
          layout();
        } else {
          save();
          move(point, true);
        }
      }
      if (ended.handle.hasPointerCapture(ended.id)) ended.handle.releasePointerCapture(ended.id);
    };
    const down = (event: PointerEvent) => {
      if (!drag) suppressClick = false;
      const handle =
        event.target instanceof win.Element
          ? event.target.closest<HTMLElement>("[data-ml-dock-drag]")
          : null;
      if (!handle || event.button !== 0 || !event.isPrimary || drag) return;
      layout();
      drag = {
        id: event.pointerId,
        handle,
        start: { x: event.clientX, y: event.clientY },
        origin: point,
        previous: position,
        moved: false,
      };
      handle.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.start.x;
      const dy = event.clientY - drag.start.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        dock.dataset.dragging = "true";
      }
      move({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== drag?.id) return;
      if (event.type === "pointerup") pointerMove(event);
      finish(event.type === "pointercancel");
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
        return;
      }
      if (!(event.target instanceof win.Element) || !event.target.closest("[data-ml-dock-drag]"))
        return;
      const step = event.shiftKey ? 40 : 10;
      const delta = new Map([
        ["ArrowLeft", { x: -step, y: 0 }],
        ["ArrowRight", { x: step, y: 0 }],
        ["ArrowUp", { x: 0, y: -step }],
        ["ArrowDown", { x: 0, y: step }],
      ]).get(event.key);
      if (event.key !== "Home" && !delta) return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      if (event.key === "Home") {
        position = DEFAULT_POSITION;
        layout();
      } else if (delta) {
        move({ x: point.x + delta.x, y: point.y + delta.y });
      }
      save();
    };
    const blur = () => finish(false);
    const resize = () => {
      visibleBounds = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
      finish(true);
      layout();
    };
    layout();
    const observer = win.ResizeObserver ? new win.ResizeObserver(layout) : null;
    observer?.observe(dock);
    const root = dom.uiRoot;
    const stopViewport =
      root instanceof win.ShadowRoot
        ? observeVisibleViewport(root.host, (rect) => {
            visibleBounds = rect;
            layout();
          })
        : () => {};
    const stopPane = dom.subscribeViewport(layout);
    dock.addEventListener("pointerdown", down);
    // Keep tracking outside the dock even if the host releases pointer capture.
    win.addEventListener("pointermove", pointerMove, true);
    win.addEventListener("pointerup", up, true);
    win.addEventListener("pointercancel", up, true);
    dock.addEventListener("click", click, true);
    dock.addEventListener("keydown", keydown, true);
    win.addEventListener("blur", blur);
    win.addEventListener("resize", resize);
    return () => {
      finish(true);
      if (frame) win.cancelAnimationFrame(frame);
      observer?.disconnect();
      stopViewport();
      stopPane();
      dock.removeEventListener("pointerdown", down);
      win.removeEventListener("pointermove", pointerMove, true);
      win.removeEventListener("pointerup", up, true);
      win.removeEventListener("pointercancel", up, true);
      dock.removeEventListener("click", click, true);
      dock.removeEventListener("keydown", keydown, true);
      win.removeEventListener("blur", blur);
      win.removeEventListener("resize", resize);
    };
  }, [dom, ref]);
}

/* oxlint-disable anti-slop/no-runtime-typeof -- Validate untrusted browser storage at the I/O boundary. */
function readPosition(win: Window): Position {
  try {
    const saved: unknown = JSON.parse(win.localStorage.getItem(POSITION_KEY) ?? "null");
    if (
      saved &&
      typeof saved === "object" &&
      "x" in saved &&
      "y" in saved &&
      typeof saved.x === "number" &&
      typeof saved.y === "number" &&
      Number.isFinite(saved.x) &&
      Number.isFinite(saved.y) &&
      saved.x >= 0 &&
      saved.x <= 1 &&
      saved.y >= 0 &&
      saved.y <= 1
    )
      return { x: saved.x, y: saved.y };
  } catch {
    // A missing, malformed, or inaccessible preference uses the default position.
  }
  return DEFAULT_POSITION;
}

/* oxlint-enable anti-slop/no-runtime-typeof */
