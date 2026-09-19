import * as stylex from "@stylexjs/stylex";
import { Component, type ContextType, type ErrorInfo, type ReactNode } from "react";

import { LensThemeContext } from "@/ui/theme";

import { rootStyles } from "../styles/root";
import { darkTheme, lightTheme } from "../styles/tokens.stylex";

type LensErrorBoundaryProps = {
  children: ReactNode;
};

type LensErrorBoundaryState = {
  error: Error | null;
};

export class LensErrorBoundary extends Component<LensErrorBoundaryProps, LensErrorBoundaryState> {
  static contextType = LensThemeContext;
  declare context: ContextType<typeof LensThemeContext>;
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
        <div
          {...stylex.props(
            rootStyles.base,
            rootStyles.error,
            this.context === "dark" ? darkTheme : lightTheme,
          )}
          data-marimo-lens-error
          role="alert"
        >
          marimo-lens render failed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
