import type { ComponentType } from "react";

import { createRender, useModel } from "@anywidget/react";

import { LensErrorBoundary } from "@/app/lens-error-boundary";
import { LensViewOwner } from "@/app/lens-view-owner";

export function createLensRender(Content: ComponentType) {
  function MarimoLens() {
    const lensId = useModel<{ _lens_id: string }>().get("_lens_id");
    return (
      <LensViewOwner lensId={lensId}>
        <LensErrorBoundary>
          <Content />
        </LensErrorBoundary>
      </LensViewOwner>
    );
  }

  return createRender(MarimoLens);
}
