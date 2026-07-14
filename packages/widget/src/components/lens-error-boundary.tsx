import { Component, type ErrorInfo, type ReactNode } from "react";

export class LensErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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
