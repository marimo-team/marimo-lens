import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { acquireLensGlobalStyles } from "@/global-styles";

export function LensPortal({ children, css }: { children: ReactNode; css: string }) {
  useLayoutEffect(() => {
    if (!css) return undefined;
    return acquireLensGlobalStyles(css);
  }, [css]);

  if (typeof document === "undefined") return <div className="marimo_lens">{children}</div>;
  return createPortal(
    <div className="marimo_lens" data-marimo-lens-root data-marimo-lens-ui>
      {children}
    </div>,
    document.body,
  );
}
