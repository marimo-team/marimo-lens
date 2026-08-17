import type { AnyWidget } from "@anywidget/types";

import { createLensRender } from "@/app/lens-render";
import { MarimoLensContent } from "@/app/marimo-lens-content";
import "@/widget.css";

export const render = createLensRender(MarimoLensContent);
const widget: AnyWidget = { render };

export default widget;
