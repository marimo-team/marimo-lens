import type { AnyWidget } from "@anywidget/types";

import { createRender } from "@anywidget/react";

import { LensErrorBoundary } from "@/app/lens-error-boundary";
import { LensViewOwner } from "@/app/lens-view-owner";
import { MarimoLensContent } from "@/app/marimo-lens-content";
import "@/widget.css";

function MarimoLens() {
  return (
    <LensViewOwner>
      <LensErrorBoundary>
        <MarimoLensContent />
      </LensErrorBoundary>
    </LensViewOwner>
  );
}

export const render = createRender(MarimoLens);
const widget: AnyWidget = { render };

export default widget;
