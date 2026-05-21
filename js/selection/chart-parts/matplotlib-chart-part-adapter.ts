import type { ChartPartMatch } from "@/selection/chart-parts/chart-part-adapter";
import type { LensChartPart, LensChartPartKind, LensTarget, ViewportPoint } from "@/types";

import { closestCrossingShadow } from "@/lib/shadow-dom";
import { chartLabel, classOrTag, dataAttributes, part } from "@/selection/chart-parts/chart-dom";
import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";

export const matplotlibChartPartAdapter = defineChartPartAdapter({
  id: "matplotlib",
  libraries: ["matplotlib"],
  priority: 940,
  match: ({ element, point, target }) => {
    const canvasMatch = canvasChartPart(element, point, target);
    if (canvasMatch) return canvasMatch;

    const idChain = ancestryIds(element);
    if (!idChain.some((id) => id.includes("figure") || id.includes("axes"))) return null;

    const legend = idChain.find((id) => id.includes("legend"));
    if (legend) {
      return {
        element,
        part: part("matplotlib", "legend", "legend", legend),
        score: 93,
      };
    }

    const axis = idChain.find(
      (id) => id.includes("axis") || id.includes("xtick") || id.includes("ytick"),
    );
    if (axis) {
      return {
        element,
        part: part("matplotlib", "axis", axisLabel(axis), axis),
        score: 91,
      };
    }

    const title = idChain.find((id) => id.includes("title") || id.includes("text"));
    if (title && element.tagName.toLowerCase() === "text") {
      return {
        element,
        part: part("matplotlib", "title", "title", chartLabel(element, title)),
        score: 89,
      };
    }

    const mark = idChain.find((id) =>
      ["line2d", "patch", "pathcollection", "quadmesh", "bar"].some((prefix) =>
        id.includes(prefix),
      ),
    );
    if (!mark) return null;
    const datum = dataAttributes(element);
    const hasDatum = Object.keys(datum).length > 0;
    return {
      element,
      part: part("matplotlib", "mark", markLabel(mark), classOrTag(element), datum),
      score: 87,
      anchorData: {
        artistId: mark,
      },
      context: {
        chartRenderer: "matplotlib-svg",
        datumSource: hasDatum ? "data-attributes" : "svg-artist-id",
        ...(hasDatum
          ? {}
          : {
              degraded: true,
              unsupportedReason:
                "Matplotlib SVG exposes the artist element but not the original row datum.",
            }),
      },
    };
  },
});

function canvasChartPart(
  element: Element,
  point: ViewportPoint | undefined,
  target: LensTarget | undefined,
): ChartPartMatch | null {
  if (!point) return null;
  const host = closestCrossingShadow(element, "marimo-matplotlib");
  const canvas = closestCrossingShadow(element, "canvas");
  if (!host || !canvas) return null;

  const rect = canvas.getBoundingClientRect();
  if (
    rect.width < 8 ||
    rect.height < 8 ||
    point.x < rect.left ||
    point.x > rect.right ||
    point.y < rect.top ||
    point.y > rect.bottom
  ) {
    return null;
  }

  const axes = axesBounds(host, canvas, rect);
  if (!axes) return null;
  const localX = point.x - rect.left;
  const localY = point.y - rect.top;
  if (localX > axes.right) {
    return canvasMatch(
      canvas,
      target,
      "legend",
      "legend",
      "canvas right",
      localRect(rect, axes.right, 0, rect.width - axes.right, rect.height),
      { localX, localY, region: "right-legend" },
    );
  }
  if (localY > axes.bottom) {
    return canvasMatch(
      canvas,
      target,
      "axis",
      "x axis",
      "canvas bottom",
      localRect(rect, axes.left, axes.bottom, axes.right - axes.left, rect.height - axes.bottom),
      { localX, localY, region: "bottom-axis" },
    );
  }
  if (localX < axes.left) {
    return canvasMatch(
      canvas,
      target,
      "axis",
      "y axis",
      "canvas left",
      localRect(rect, 0, axes.top, axes.left, axes.bottom - axes.top),
      { localX, localY, region: "left-axis" },
    );
  }
  if (localX >= axes.left && localX <= axes.right && localY >= axes.top && localY <= axes.bottom) {
    return canvasMatch(
      canvas,
      target,
      "mark",
      "mark",
      "canvas axes",
      localRect(rect, axes.left, axes.top, axes.right - axes.left, axes.bottom - axes.top),
      {
        localX,
        localY,
        normalizedAxesX: (localX - axes.left) / Math.max(axes.right - axes.left, 1),
        normalizedAxesY: (localY - axes.top) / Math.max(axes.bottom - axes.top, 1),
        region: "axes",
      },
    );
  }
  return canvasMatch(canvas, target, "plot-area", "plot area", "canvas", rect, {
    localX,
    localY,
    region: "canvas",
  });
}

function canvasMatch(
  element: Element,
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  fallbackLabel: string,
  fallbackDetail: string,
  highlightRect: DOMRect,
  anchorData: Record<string, unknown>,
): ChartPartMatch {
  const metadata = metadataPart(target, kind, fallbackLabel);
  return {
    element,
    part: part(
      "matplotlib",
      kind,
      metadata?.label ?? fallbackLabel,
      metadata?.detail ?? fallbackDetail,
    ),
    score: kind === "mark" ? 88 : 90,
    highlight: {
      kind: "rect",
      rect: highlightRect,
      padding: 1,
      strategy: "chart-part-canvas-region",
    },
    anchorData,
    context: {
      chartRenderer: "matplotlib-canvas",
      evidence: "canvas-axes-bounds",
      ...(kind === "mark"
        ? {
            degraded: true,
            unsupportedReason:
              "Matplotlib canvas exposes axes regions and pointer coordinates, not per-datum artists.",
          }
        : {}),
    },
  };
}

function localRect(
  rect: DOMRect,
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(rect.left + left, rect.top + top, width, height);
}

function axesBounds(
  host: Element,
  canvas: Element,
  rect: DOMRect,
): { left: number; top: number; right: number; bottom: number } | null {
  const parsed = parseNumberArray(host.getAttribute("data-axes-pixel-bounds"));
  if (parsed.length >= 4) {
    const width = Number((canvas as HTMLCanvasElement).width || host.getAttribute("data-width"));
    const height = Number((canvas as HTMLCanvasElement).height || host.getAttribute("data-height"));
    const scaleX = width > 0 ? rect.width / width : 1;
    const scaleY = height > 0 ? rect.height / height : 1;
    return clampAxesBounds(
      parsed[0] * scaleX,
      parsed[1] * scaleY,
      parsed[2] * scaleX,
      parsed[3] * scaleY,
      rect,
    );
  }
  return clampAxesBounds(
    rect.width * 0.13,
    rect.height * 0.12,
    rect.width * 0.78,
    rect.height * 0.8,
    rect,
  );
}

function clampAxesBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  rect: DOMRect,
): { left: number; top: number; right: number; bottom: number } | null {
  if (rect.width < 16 || rect.height < 16) return null;
  const clampedLeft = clamp(left, 0, rect.width - 8);
  const clampedTop = clamp(top, 0, rect.height - 8);
  return {
    left: clampedLeft,
    top: clampedTop,
    right: clamp(right, clampedLeft + 8, rect.width),
    bottom: clamp(bottom, clampedTop + 8, rect.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumberArray(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

function metadataPart(
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  preferredLabel: string,
): Pick<LensChartPart, "detail" | "kind" | "label"> | null {
  const parts = target?.chart?.parts ?? [];
  const preferred = preferredLabel.toLowerCase();
  return (
    parts.find((item) => {
      const detail = String(item.detail ?? "").toLowerCase();
      const label = `${item.label} ${detail}`.toLowerCase();
      return (
        item.kind === kind &&
        (label.includes(preferred) || Boolean(detail && preferred.includes(detail)))
      );
    }) ??
    parts.find((item) => item.kind === kind) ??
    null
  );
}

function ancestryIds(element: Element): string[] {
  const ids: string[] = [];
  let current: Element | null = element;
  while (current) {
    const id = current.getAttribute("id");
    if (id) ids.push(id.toLowerCase());
    current = current.parentElement;
  }
  return ids;
}

function axisLabel(id: string): string {
  if (id.includes("xaxis") || id.includes("xtick")) return "x axis";
  if (id.includes("yaxis") || id.includes("ytick")) return "y axis";
  return "axis";
}

function markLabel(id: string): string {
  if (id.includes("line2d")) return "line";
  if (id.includes("pathcollection")) return "points";
  if (id.includes("patch")) return "patch";
  if (id.includes("quadmesh")) return "mesh";
  return "mark";
}
