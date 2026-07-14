import type { ViewportPoint } from "@/types";

import { closestCrossingShadow, elementsAtPointCrossingShadow } from "@/lib/shadow-dom";

export function surfaceAtElementOrPoint(
  element: Element,
  selector: string,
  point?: ViewportPoint,
): Element | null {
  const direct = closestCrossingShadow(element, selector);
  for (const candidate of elementsAtPointCrossingShadow(point)) {
    const surface = closestCrossingShadow(candidate, selector);
    if (surface && surface !== direct) return surface;
  }
  return direct;
}
