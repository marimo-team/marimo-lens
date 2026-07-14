import type { SelectionPlugin } from "@/selection/selection-plugin";

import { chartPartSelectionPlugin } from "@/selection/plugins/chart-part-selection-plugin";
import {
  columnarDomSelectionPlugin,
  columnarGridSelectionPlugin,
} from "@/selection/plugins/columnar-selection-plugin";
import { displayCellSelectionPlugin } from "@/selection/plugins/display-cell-selection-plugin";
import { documentSelectionPlugin } from "@/selection/plugins/document-selection-plugin";
import { interactiveSelectionPlugin } from "@/selection/plugins/interactive-selection-plugin";
import { markedTargetPlugin } from "@/selection/plugins/marked-target-plugin";
import { mediaSelectionPlugin } from "@/selection/plugins/media-selection-plugin";
import { createSelectorSelectionPlugin } from "@/selection/plugins/selector-selection-plugin";
import { visualSelectionPlugin } from "@/selection/plugins/visual-selection-plugin";

const selectorSelectionPlugin = createSelectorSelectionPlugin({
  id: "target-selector",
  priority: 800,
});

export const defaultSelectionPlugins: SelectionPlugin[] = [
  markedTargetPlugin,
  columnarDomSelectionPlugin,
  columnarGridSelectionPlugin,
  chartPartSelectionPlugin,
  visualSelectionPlugin,
  interactiveSelectionPlugin,
  mediaSelectionPlugin,
  documentSelectionPlugin,
  selectorSelectionPlugin,
  displayCellSelectionPlugin,
];
