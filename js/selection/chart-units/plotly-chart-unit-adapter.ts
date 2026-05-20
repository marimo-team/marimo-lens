import { chartLabel, classOrTag, dataAttributes, unit } from "@/selection/chart-units/chart-dom";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";

export const plotlyChartUnitAdapter = defineChartUnitAdapter({
  id: "plotly",
  libraries: ["plotly"],
  priority: 960,
  match: ({ element }) => {
    const plotlyRoot = element.closest?.(".plotly,.js-plotly-plot");
    if (!plotlyRoot) return null;

    const legend = element.closest?.(".legend,.legendtoggle,.traces");
    if (legend) {
      return {
        element: legend,
        unit: unit("plotly", "legend", "legend", classOrTag(legend)),
        score: 93,
      };
    }

    const axis = element.closest?.(
      ".xaxislayer-above,.yaxislayer-above,.xtick,.ytick,.xtitle,.ytitle",
    );
    if (axis) {
      return {
        element: axis,
        unit: unit("plotly", "axis", axisLabel(axis), chartLabel(axis, classOrTag(axis))),
        score: 91,
      };
    }

    const title = element.closest?.(".gtitle,.annotation");
    if (title) {
      return {
        element: title,
        unit: unit("plotly", "title", "title", chartLabel(title, "title")),
        score: 90,
      };
    }

    const mark = element.closest?.(
      ".point,.points,.trace,.barlayer,.scatterlayer,.pielayer,.cartesianlayer",
    );
    if (!mark) return null;
    return {
      element: mark,
      unit: unit("plotly", "trace", traceLabel(mark), classOrTag(mark), dataAttributes(mark)),
      score: 88,
    };
  },
});

function axisLabel(element: Element): string {
  const className = element.getAttribute("class") ?? "";
  if (className.includes("x")) return "x axis";
  if (className.includes("y")) return "y axis";
  return "axis";
}

function traceLabel(element: Element): string {
  const className = element.getAttribute("class") ?? "";
  if (className.includes("bar")) return "bar trace";
  if (className.includes("scatter")) return "scatter trace";
  if (className.includes("pie")) return "pie trace";
  return "trace";
}
