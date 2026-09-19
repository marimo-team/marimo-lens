import type { KeyboardEvent } from "react";

import * as stylex from "@stylexjs/stylex";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { TrailNavigation } from "@/transient/target-attention";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { iconButtonStyles } from "@/styles/primitives";
import { focusDock } from "@/ui/focus";

import { transientStyles } from "./transient.styles";

export function TrailControls({ trail }: { trail: TrailNavigation }) {
  const dom = useNotebookDom();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      trail.close();
      focusDock(dom);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowLeft") trail.previous();
    else trail.next();
  };
  return (
    <nav
      {...stylex.props(transientStyles.trail)}
      aria-label={trail.count > 1 ? "Walkthrough steps" : "Reveal controls"}
      data-marimo-lens-ui
    >
      {trail.count > 1 && (
        <>
          <button
            {...stylex.props(
              ...iconButtonStyles,
              transientStyles.trailButton,
              trail.index === 0 && transientStyles.trailButtonDisabled,
            )}
            type="button"
            aria-label="Previous trail step"
            aria-disabled={trail.index === 0}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              trail.previous();
            }}
            onKeyDown={onKeyDown}
          >
            <ChevronLeft size={12} aria-hidden="true" />
          </button>
          <span {...stylex.props(transientStyles.trailCount)}>
            {trail.index + 1} / {trail.count}
          </span>
          <button
            {...stylex.props(
              ...iconButtonStyles,
              transientStyles.trailButton,
              trail.index === trail.count - 1 && transientStyles.trailButtonDisabled,
            )}
            type="button"
            aria-label="Next trail step"
            aria-disabled={trail.index === trail.count - 1}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              trail.next();
            }}
            onKeyDown={onKeyDown}
          >
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        </>
      )}
      <button
        {...stylex.props(...iconButtonStyles, transientStyles.trailButton)}
        type="button"
        aria-label={trail.count > 1 ? "End trail" : "Dismiss reveal"}
        onKeyDown={onKeyDown}
        onClick={() => {
          trail.close();
          focusDock(dom);
        }}
      >
        <X size={10} aria-hidden="true" />
      </button>
    </nav>
  );
}
