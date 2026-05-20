import { useEffect, useState } from "react";
import { scrollableAncestors } from "@/lib/scroll-ancestors";

export function useElementRect(element: Element | null | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() => element?.getBoundingClientRect() ?? null);

  useEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setRect(element.getBoundingClientRect());
      });
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    const scrollTargets = scrollableAncestors(element);
    for (const target of scrollTargets) {
      target.addEventListener("scroll", measure, { passive: true });
    }
    window.addEventListener("resize", measure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const target of scrollTargets) {
        target.removeEventListener("scroll", measure);
      }
      window.removeEventListener("resize", measure);
    };
  }, [element]);

  return rect;
}
