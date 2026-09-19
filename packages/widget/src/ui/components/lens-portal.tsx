import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { observeVisibleViewport } from "@/notebook/viewport";
import { createLensSurface } from "@/ui/lens-surface";
import { useLensTheme } from "@/ui/theme";

import { rootStyles } from "../../styles/root";
import { darkTheme, lightTheme } from "../../styles/tokens.stylex";

export function LensPortal({ children, css }: { children: ReactNode; css: string }) {
  const dom = useNotebookDom();
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const theme = useLensTheme();
  useLayoutEffect(() => {
    const surface = createLensSurface(dom.document);
    const releaseRoot = dom.registerUiRoot(surface.root);
    const releaseViewport = observeVisibleViewport(surface.host, (bounds) => {
      surface.host.style.setProperty(
        "--ml-viewport-bottom",
        `${Math.max(0, dom.window.innerHeight - bounds.bottom)}px`,
      );
    });
    setRoot(surface.root);
    return () => {
      releaseViewport();
      releaseRoot();
      surface.dispose();
    };
  }, [dom]);

  return root
    ? createPortal(
        <>
          <style>{css}</style>
          <div
            className={`marimo_lens ${
              stylex.props(
                rootStyles.base,
                rootStyles.portal,
                theme === "dark" ? darkTheme : lightTheme,
              ).className
            }`}
            data-marimo-lens-root
            data-marimo-lens-ui
          >
            {children}
          </div>
        </>,
        root,
      )
    : null;
}
