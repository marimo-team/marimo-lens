import type { AnyWidget } from "@anywidget/types";

import { createRender, useModel } from "@anywidget/react";

import { LensErrorBoundary } from "@/components/lens-error-boundary";
import { LensViewOwner } from "@/components/lens-view-owner";
import { MarimoLensContent } from "@/components/marimo-lens-content";
import "@/widget.css";

function MarimoLens() {
  const model = useModel();

  return (
    <LensViewOwner model={model}>
      <LensErrorBoundary>
        <MarimoLensContent />
      </LensErrorBoundary>
    </LensViewOwner>
  );
}

const render = createRender(MarimoLens);
const widget: AnyWidget = { render };

export default widget;
