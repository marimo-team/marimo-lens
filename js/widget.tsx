import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRender } from "@anywidget/react";
import { createPortal } from "react-dom";
import { LensDock } from "@/components/lens-dock";
import { LensOverlay } from "@/components/lens-overlay";
import { useAgentCommands } from "@/hooks/use-agent-commands";
import { useLensCapture } from "@/hooks/use-lens-capture";
import { useLensModel } from "@/hooks/use-lens-model";
import { useLensTheme } from "@/hooks/use-lens-theme";
import { LensUiStoreProvider } from "@/store";
import "@/widget.css";

function MarimoLens() {
  return (
    <LensUiStoreProvider>
      <MarimoLensContent />
    </LensUiStoreProvider>
  );
}

function MarimoLensContent() {
  const model = useLensModel();
  const theme = useLensTheme();
  useLensGlobalStyles(model.lensCss);
  useLensCapture(model.targets);
  useAgentCommands(model.agentCommands);

  return (
    <LensPortal theme={theme}>
      <LensDock
        title={model.title}
        targets={model.targets}
        graph={model.graph}
        annotations={model.annotations}
        agentActivity={model.agentActivity}
        markdown={model.markdown}
        pair_prompt={model.pair_prompt}
        contextRevision={model.contextRevision}
        onScan={model.refreshContext}
        onClear={model.clearAnnotations}
        onRemove={model.removeAnnotation}
      />
      <LensOverlay
        annotations={model.annotations}
        agentActivity={model.agentActivity}
        graph={model.graph}
        onAddAnnotation={model.addAnnotation}
      />
    </LensPortal>
  );
}

function useLensGlobalStyles(css: string) {
  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const existing = document.getElementById("marimo-lens-global-styles");
    if (existing) {
      if (css) existing.textContent = css;
      return undefined;
    }

    const style = document.createElement("style");
    style.id = "marimo-lens-global-styles";
    style.setAttribute("data-marimo-lens-ui", "true");
    style.textContent = css;
    document.head.appendChild(style);

    return undefined;
  }, [css]);
}

function LensPortal({ children, theme }: { children: ReactNode; theme: "dark" | "light" }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stopPortalEvent = (event: Event) => {
      const wrapper = wrapperRef.current;
      if (wrapper && event.target instanceof Node && wrapper.contains(event.target)) {
        event.stopPropagation();
      }
    };
    const events = ["pointerdown", "mousedown", "click"] as const;
    events.forEach((eventName) => document.body.addEventListener(eventName, stopPortalEvent));
    return () => {
      events.forEach((eventName) => document.body.removeEventListener(eventName, stopPortalEvent));
    };
  }, []);

  if (typeof document === "undefined") {
    return (
      <div className="marimo_lens" data-theme={theme}>
        {children}
      </div>
    );
  }

  return createPortal(
    <div
      ref={wrapperRef}
      className="marimo_lens"
      data-theme={theme}
      data-marimo-lens-root
      data-marimo-lens-ui
    >
      {children}
    </div>,
    document.body,
  );
}

const render = createRender(MarimoLens);

export default { render };
