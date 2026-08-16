import { Component, type ErrorInfo, type ReactNode } from "react";

type LensErrorBoundaryProps = {
  children: ReactNode;
};

type LensErrorBoundaryState = {
  error: Error | null;
};

export class LensErrorBoundary extends Component<LensErrorBoundaryProps, LensErrorBoundaryState> {
  state: LensErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LensErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("marimo-lens render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="marimo_lens" data-marimo-lens-error role="alert">
          marimo-lens render failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
