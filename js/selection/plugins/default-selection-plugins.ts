import { chartUnitSelectionPlugin } from "@/selection/plugins/chart-unit-selection-plugin";
import {
  columnarDomSelectionPlugin,
  columnarGridSelectionPlugin,
} from "@/selection/plugins/columnar-selection-plugin";
import { documentSelectionPlugin } from "@/selection/plugins/document-selection-plugin";
import { displayCellSelectionPlugin } from "@/selection/plugins/display-cell-selection-plugin";
import { interactiveSelectionPlugin } from "@/selection/plugins/interactive-selection-plugin";
import { markedTargetPlugin } from "@/selection/plugins/marked-target-plugin";
import { mediaSelectionPlugin } from "@/selection/plugins/media-selection-plugin";
import { createSelectorSelectionPlugin } from "@/selection/plugins/selector-selection-plugin";
import { visualSelectionPlugin } from "@/selection/plugins/visual-selection-plugin";
import type { SelectionPlugin } from "@/selection/selection-plugin";

const selectorSelectionPlugin = createSelectorSelectionPlugin({
  id: "target-selector",
  priority: 800,
});

export const defaultSelectionPlugins: SelectionPlugin[] = [
  markedTargetPlugin,
  columnarDomSelectionPlugin,
  columnarGridSelectionPlugin,
  chartUnitSelectionPlugin,
  visualSelectionPlugin,
  interactiveSelectionPlugin,
  mediaSelectionPlugin,
  documentSelectionPlugin,
  selectorSelectionPlugin,
  displayCellSelectionPlugin,
];
