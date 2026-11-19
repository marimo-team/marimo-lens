import type { Render } from "@anywidget/types";
import type { ComponentType } from "react";

import { createRender, useModel } from "@anywidget/react";

import { LensErrorBoundary } from "@/app/lens-error-boundary";
import { LensViewOwner } from "@/app/lens-view-owner";

declare global {
  interface Window {
    // marimo sets this in static exports, which render saved widget state without a kernel.
    __MARIMO_STATIC__?: unknown;
  }
}

export function createLensRender(Content: ComponentType): Render {
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

  const render = createRender(MarimoLens);
  return (props) =>
    props.el.ownerDocument.defaultView?.__MARIMO_STATIC__ ? undefined : render(props);
}
