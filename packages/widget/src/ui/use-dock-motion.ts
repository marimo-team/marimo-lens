import { useLayoutEffect, type RefObject } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { motion } from "@/styles/tokens.stylex";

// Morph the surface, leaving text and controls at their natural size.
export function useDockMotion(ref: RefObject<HTMLElement | null>) {
  const dom = useNotebookDom();
  useLayoutEffect(() => {
    const dock = ref.current;
    if (!dock) return;
    const win = dom.window;
    let from: { x: number; y: number; width: number; height: number } | null = null;
    let animations: Animation[] = [];
    const cancel = () => {
      for (const animation of animations) animation.cancel();
      animations = [];
    };
    const remember = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.detail === 0 ||
        win.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      if (!(event.target instanceof win.Element) || !event.target.closest("[data-ml-dock-toggle]"))
        return;
      const surface = dock.querySelector<HTMLElement>("[data-marimo-lens-dock-surface]");
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const transform = win.getComputedStyle(surface, "::before").transform;
      const matrix = new win.DOMMatrixReadOnly(transform === "none" ? undefined : transform);
      from = {
        x: rect.x + matrix.e,
        y: rect.y + matrix.f,
        width: rect.width * matrix.a,
        height: rect.height * matrix.d,
      };
      cancel();
    };
    const animate = () => {
      if (!from) return;
      const surface = dock.querySelector<HTMLElement>("[data-marimo-lens-dock-surface]");
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const previous = from;
      from = null;
      if (!surface.animate || rect.width === 0 || rect.height === 0) return;
      animations = [
        surface.animate(
          [
            {
              transform: `translate(${previous.x - rect.x}px, ${previous.y - rect.y}px) scale(${previous.width / rect.width}, ${previous.height / rect.height})`,
            },
            { transform: "none" },
          ],
          { duration: 200, easing: motion.easeOut, pseudoElement: "::before" },
        ),
        ...[...surface.children].map((child) =>
          child.animate([{ opacity: 0.6 }, { opacity: 1 }], {
            duration: 125,
            easing: motion.easeOut,
          }),
        ),
      ];
    };
    const interrupt = () => {
      from = null;
      cancel();
    };
    const observer = win.ResizeObserver ? new win.ResizeObserver(animate) : null;
    observer?.observe(dock);
    dock.addEventListener("click", remember, true);
    dock.addEventListener("keydown", interrupt, true);
    win.addEventListener("resize", interrupt);
    return () => {
      cancel();
      observer?.disconnect();
      dock.removeEventListener("click", remember, true);
      dock.removeEventListener("keydown", interrupt, true);
      win.removeEventListener("resize", interrupt);
    };
  }, [dom, ref]);
}
