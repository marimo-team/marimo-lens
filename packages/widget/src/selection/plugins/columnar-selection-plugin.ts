import {
  bestColumnarTarget,
  isColumnarDomTarget,
  isColumnarGridTarget,
} from "@/lib/column-targeting";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceAtElementOrPoint } from "@/selection/surface-targeting";
import { tableSemanticSelection } from "@/selection/table-semantic-selection";

const COLUMNAR_DOM_SELECTOR = "table,[role='table'],[data-column],[data-column-name],[data-field]";
const COLUMNAR_GRID_SELECTOR = "[role='grid'],canvas,marimo-data-editor";

export const columnarDomSelectionPlugin = defineSelectionPlugin({
  id: "columnar-dom",
  surface: "columnar-dom",
  priority: 900,
  select: ({ element, point, targets }) => {
    const surface = columnarSurface(element, COLUMNAR_DOM_SELECTOR, point);
    if (!surface) return null;
    const target = bestColumnarTarget(element, targets.filter(isColumnarDomTarget), point);
    if (!target) return null;
    const semanticSelection = tableSemanticSelection({
      target,
      sourceElement: element,
      surface,
      surfaceName: "columnar-dom",
      point,
    });
    if (!semanticSelection) return null;
    return {
      target,
      semanticSelection,
      score: semanticSelection.kind === "column" ? 86 : 72,
    };
  },
});

export const columnarGridSelectionPlugin = defineSelectionPlugin({
  id: "columnar-grid",
  surface: "columnar-grid",
  priority: 890,
  select: ({ element, point, targets }) => {
    const surface = columnarSurface(element, COLUMNAR_GRID_SELECTOR, point);
    if (!surface) return null;
    const target = bestColumnarTarget(element, targets.filter(isColumnarGridTarget), point);
    if (!target) return null;
    const semanticSelection = tableSemanticSelection({
      target,
      sourceElement: element,
      surface,
      surfaceName: "columnar-grid",
      point,
    });
    if (!semanticSelection) return null;
    return {
      target,
      semanticSelection,
      score: semanticSelection.kind === "column" ? 88 : 70,
    };
  },
});

function columnarSurface(
  element: Element,
  selector: string,
  point?: { x: number; y: number },
): Element | null {
  return surfaceAtElementOrPoint(element, selector, point);
}
