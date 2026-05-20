import { chartLabel, classOrTag, unit } from "@/selection/chart-units/chart-dom";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";

export const matplotlibChartUnitAdapter = defineChartUnitAdapter({
  id: "matplotlib",
  libraries: ["matplotlib"],
  priority: 940,
  match: ({ element }) => {
    const idChain = ancestryIds(element);
    if (!idChain.some((id) => id.includes("figure") || id.includes("axes"))) return null;

    const legend = idChain.find((id) => id.includes("legend"));
    if (legend) {
      return {
        element,
        unit: unit("matplotlib", "legend", "legend", legend),
        score: 93,
      };
    }

    const axis = idChain.find(
      (id) => id.includes("axis") || id.includes("xtick") || id.includes("ytick"),
    );
    if (axis) {
      return {
        element,
        unit: unit("matplotlib", "axis", axisLabel(axis), axis),
        score: 91,
      };
    }

    const title = idChain.find((id) => id.includes("title") || id.includes("text"));
    if (title && element.tagName.toLowerCase() === "text") {
      return {
        element,
        unit: unit("matplotlib", "title", "title", chartLabel(element, title)),
        score: 89,
      };
    }

    const mark = idChain.find((id) =>
      ["line2d", "patch", "pathcollection", "quadmesh", "bar"].some((prefix) =>
        id.includes(prefix),
      ),
    );
    if (!mark) return null;
    return {
      element,
      unit: unit("matplotlib", "mark", markLabel(mark), classOrTag(element)),
      score: 87,
    };
  },
});

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
