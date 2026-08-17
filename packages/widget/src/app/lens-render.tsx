import type { ComponentType } from "react";

import { createRender } from "@anywidget/react";

import { LensErrorBoundary } from "@/app/lens-error-boundary";
import { LensViewOwner } from "@/app/lens-view-owner";

export function createLensRender(Content: ComponentType) {
  function MarimoLens() {
    return (
      <LensViewOwner>
        <LensErrorBoundary>
          <Content />
        </LensErrorBoundary>
      </LensViewOwner>
    );
  }

  return createRender(MarimoLens);
}
