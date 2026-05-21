import type { ChartPartMatch } from "@/selection/chart-parts/chart-part-adapter";
import type { ViewportPoint } from "@/types";

import { chartLabel, classOrTag, dataAttributes, part } from "@/selection/chart-parts/chart-dom";
import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";

export const plotlyChartPartAdapter = defineChartPartAdapter({
  id: "plotly",
  libraries: ["plotly"],
  priority: 960,
  match: ({ element, point }) => {
    const plotlyRoot = plotlyRootFor(element);
    if (!plotlyRoot) return null;

    const legend = element.closest?.(".legend,.legendtoggle,.traces");
    if (legend) {
      return {
        element: legend,
        part: part("plotly", "legend", "legend", classOrTag(legend)),
        score: 93,
      };
    }

    const pointMatch = point ? pointTraceAt(plotlyRoot, point) : null;
    if (pointMatch) return pointMatch;

    const canvasFallback = point ? plotlyCanvasFallback(plotlyRoot, point) : null;
    if (canvasFallback) return canvasFallback;

    const axis = element.closest?.(
      ".xaxislayer-above,.yaxislayer-above,.xtick,.ytick,.xtitle,.ytitle",
    );
    if (axis) {
      return {
        element: axis,
        part: part("plotly", "axis", axisLabel(axis), chartLabel(axis, classOrTag(axis))),
        score: 91,
      };
    }

    const annotation = element.closest?.(".annotation");
    if (annotation) {
      return {
        element: annotation,
        part: part(
          "plotly",
          "annotation",
          chartLabel(annotation, "annotation"),
          classOrTag(annotation),
        ),
        score: 90,
      };
    }

    const title = element.closest?.(".gtitle");
    if (title) {
      return {
        element: title,
        part: part("plotly", "title", "title", chartLabel(title, "title")),
        score: 90,
      };
    }

    const dragSurface = element.closest?.(".draglayer,.nsewdrag,.drag");
    if (dragSurface) {
      return {
        element: dragSurface,
        part: part("plotly", "plot-area", "plot area", classOrTag(dragSurface)),
        score: 87,
      };
    }

    const mark = element.closest?.(
      [
        ".point",
        ".points",
        ".trace",
        ".barlayer",
        ".boxlayer",
        ".cartesianlayer",
        ".funnelarealayer",
        ".funnellayer",
        ".heatmaplayer",
        ".histogramlayer",
        ".hm",
        ".pielayer",
        ".scatterlayer",
        ".slice",
        ".sunburstlayer",
        ".treemaplayer",
        ".violinlayer",
        ".waterfalllayer",
      ].join(","),
    );
    if (!mark) return null;
    return {
      element: mark,
      part: part("plotly", "trace", traceLabel(mark), classOrTag(mark), dataAttributes(mark)),
      score: 88,
    };
  },
});

function plotlyRootFor(element: Element): Element | null {
  const local = element.closest?.(".plotly,.js-plotly-plot");
  if (local) return local;
  const host = element.closest?.("marimo-plotly");
  return host instanceof HTMLElement
    ? (host.shadowRoot?.querySelector(".plotly,.js-plotly-plot") ?? null)
    : null;
}

function pointTraceAt(plotlyRoot: Element, point: ViewportPoint): ChartPartMatch | null {
  const candidates = [...plotlyRoot.querySelectorAll(".scatterlayer path.point,path.point")]
    .map((element) => pointCandidate(element, point))
    .filter((candidate): candidate is PointCandidate => candidate !== null)
    .sort((left, right) => left.distance - right.distance);
  const candidate = candidates[0];
  if (!candidate) return null;

  const trace =
    candidate.element.closest(".trace") ??
    candidate.element.closest(".points,.scatterlayer") ??
    candidate.element;
  return {
    element: candidate.element,
    part: part("plotly", "trace", traceLabel(trace), classOrTag(candidate.element), {
      ...dataAttributes(trace),
      ...dataAttributes(candidate.element),
    }),
    score: 97,
  };
}

function plotlyCanvasFallback(plotlyRoot: Element, point: ViewportPoint): ChartPartMatch | null {
  const canvas = [...plotlyRoot.querySelectorAll("canvas")].find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return (
      rect.width >= 2 &&
      rect.height >= 2 &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  });
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    element: canvas,
    part: part("plotly", "plot-area", "Plotly canvas/WebGL plot area", classOrTag(canvas)),
    score: 70,
    highlight: {
      kind: "rect",
      rect,
      padding: 1,
      strategy: "plotly-canvas-surface",
    },
    anchorData: {
      renderer: "plotly-canvas",
      x: point.x - rect.left,
      y: point.y - rect.top,
    },
    context: {
      chartRenderer: "plotly-canvas",
      degraded: true,
      unsupportedReason: "Plotly canvas/WebGL does not expose DOM marks",
    },
  };
}

type PointCandidate = {
  element: Element;
  distance: number;
};

function pointCandidate(element: Element, point: ViewportPoint): PointCandidate | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const padding = Math.max(6, Math.min(12, Math.max(rect.width, rect.height)));
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  const distance = Math.hypot(dx, dy);
  if (distance > padding) return null;
  return { element, distance };
}

function axisLabel(element: Element): string {
  const tokens = classTokens(element);
  if (tokens.some((token) => /^x(axis|tick|grid|$)|^x[0-9]?/.test(token))) return "x axis";
  if (tokens.some((token) => /^y(axis|tick|grid|$)|^y[0-9]?/.test(token))) return "y axis";
  return "axis";
}

function traceLabel(element: Element): string {
  const tokens = classTokens(element);
  if (tokens.some((token) => token.includes("bar"))) return "bar trace";
  if (tokens.some((token) => token.includes("scatter"))) return "scatter trace";
  if (tokens.some((token) => token.includes("pie"))) return "pie trace";
  return "trace";
}

function classTokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}
