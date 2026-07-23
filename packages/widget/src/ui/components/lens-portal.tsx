import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { acquireLensGlobalStyles } from "@/ui/global-styles";

export function LensPortal({ children, css }: { children: ReactNode; css: string }) {
  const dom = useNotebookDom();
  useLayoutEffect(() => {
    if (!css) return undefined;
    return acquireLensGlobalStyles(dom.document, css);
  }, [css, dom]);

  return createPortal(
    <div className="marimo_lens" data-marimo-lens-root data-marimo-lens-ui>
      {children}
    </div>,
    dom.portalTarget,
  );
}
