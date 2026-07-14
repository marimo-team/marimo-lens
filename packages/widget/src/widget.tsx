import { createRender } from "@anywidget/react";
import type { AnyWidget } from "@anywidget/types";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
    <LensErrorBoundary>
      <LensUiStoreProvider>
        <MarimoLensContent />
      </LensUiStoreProvider>
    </LensErrorBoundary>
  );
}

class LensErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("marimo-lens render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="marimo_lens" data-marimo-lens-error>
          marimo-lens render failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
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
        pairFeedback={model.pairFeedback}
        pair_prompt={model.pair_prompt}
        contextRevision={model.contextRevision}
        refreshState={model.refreshState}
        onScan={model.refreshContext}
        onClear={model.clearAnnotations}
      />
      <LensOverlay
        annotations={model.annotations}
        agentActivity={model.agentActivity}
        graph={model.graph}
        onAddAnnotation={model.addAnnotation}
        onUpdateAnnotation={model.updateAnnotation}
        onDeleteAnnotation={model.deleteAnnotation}
      />
    </LensPortal>
  );
}

function useLensGlobalStyles(css: string) {
  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const existing = document.getElementById("marimo-lens-global-styles");
    if (existing) {
      existing.textContent = css;
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

const widget: AnyWidget = { render };

export default widget;
