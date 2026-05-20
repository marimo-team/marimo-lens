import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";

export const metadataChartUnitAdapter = defineChartUnitAdapter({
  id: "metadata-selector",
  priority: 1000,
  match: ({ element, target }) => {
    const units = target?.chart?.parts ?? [];
    for (const unit of units) {
      if (!unit.selector) continue;
      const match = closestCrossingShadow(element, unit.selector);
      if (!match) continue;
      return {
        element: match,
        unit,
        score: 98,
        context: {
          selector: unit.selector,
          source: "chart-metadata",
        },
      };
    }
    return null;
  },
});
