import { cssEscape } from "@/lib/css-selectors";

export type CellElementPreference = "output" | "cell";

export function cellElement(
  cellId: string,
  preference: CellElementPreference = "output",
): Element | null {
  const output = document.getElementById(`output-${cellId}`) ?? undefined;
  const cell = document.getElementById(`cell-${cellId}`) ?? undefined;
  const raw = document.getElementById(cellId) ?? undefined;
  const dataCell = document.querySelector(`[data-cell-id="${cssEscape(cellId)}"]`) ?? undefined;
  const candidates =
    preference === "cell" ? [cell, dataCell, raw, output] : [output, cell, raw, dataCell];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const element = usableCellAnchor(candidate);
    if (element) return element;
  }
  return null;
}

export function paddedRect(rect: DOMRect, pad = 3): DOMRect {
  return new DOMRect(rect.left - pad, rect.top - pad, rect.width + pad * 2, rect.height + pad * 2);
}

export function isUsableRegion(rect: DOMRect): boolean {
  return rect.width >= 8 && rect.height >= 8;
}

function usableCellAnchor(element: Element): Element | null {
  if (isUsableRegion(element.getBoundingClientRect())) return element;

  let current: Element | null = element.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isCellLikeAnchor(current) && isUsableRegion(current.getBoundingClientRect())) {
      return current;
    }
    current = current.parentElement;
  }

  const root = element.getRootNode?.();
  if (root instanceof ShadowRoot && isUsableRegion(root.host.getBoundingClientRect())) {
    return root.host;
  }
  return null;
}

function isCellLikeAnchor(element: Element): boolean {
  const id = element.id;
  return (
    element.hasAttribute("data-cell-id") ||
    id.startsWith("cell-") ||
    id.startsWith("output-") ||
    element.classList.contains("marimo-cell")
  );
}
