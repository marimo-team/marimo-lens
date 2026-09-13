import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { createLensSurface } from "@/ui/lens-surface";

export function LensPortal({ children, css }: { children: ReactNode; css: string }) {
  const dom = useNotebookDom();
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    const surface = createLensSurface(dom.document);
    const releaseRoot = dom.registerUiRoot(surface.root);
    setRoot(surface.root);
    return () => {
      releaseRoot();
      surface.dispose();
    };
  }, [dom]);

  return root
    ? createPortal(
        <>
          <style>{css}</style>
          <div className="marimo_lens" data-marimo-lens-root data-marimo-lens-ui>
            {children}
          </div>
        </>,
        root,
      )
    : null;
}
