import type { AnyWidget } from "@anywidget/types";

import { createRender } from "@anywidget/react";

import { LensErrorBoundary } from "@/components/lens-error-boundary";
import { MarimoLensContent } from "@/components/marimo-lens-content";
import "@/widget.css";

function MarimoLens() {
  return (
    <LensErrorBoundary>
      <MarimoLensContent />
    </LensErrorBoundary>
  );
}

const render = createRender(MarimoLens);
const widget: AnyWidget = { render };

export default widget;
