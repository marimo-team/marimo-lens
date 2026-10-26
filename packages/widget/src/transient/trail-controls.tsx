import * as stylex from "@stylexjs/stylex";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { TrailNavigation } from "@/transient/target-attention";

import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { iconButtonStyles } from "@/styles/primitives";
import { focusDock } from "@/ui/focus";

import { transientStyles } from "./transient.styles";

export function TrailControls({ trail }: { trail: TrailNavigation }) {
  const dom = useNotebookDom();
  const nav = useRef<HTMLElement>(null);
  useTrailFocusHandOff(dom, nav);
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
      ref={nav}
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

// The control a trail held focus on when its controls unmounted, per document.
const handedOff = new WeakMap<NotebookDomAdapter, string>();

/**
 * Keep keyboard focus when trail controls unmount under it. Controls that
 * mount in the same commit, such as the stepper moving into the dock, take it
 * back on the same control. Otherwise focus that fell to the page goes to the
 * dock.
 */
function useTrailFocusHandOff(dom: NotebookDomAdapter, nav: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return undefined;
    const label = handedOff.get(dom);
    handedOff.delete(dom);
    if (label !== undefined) {
      const control = Array.from(element.querySelectorAll("button")).find(
        (button) => button.getAttribute("aria-label") === label,
      );
      control?.focus({ preventScroll: true });
    }
    // React runs this before it removes the controls, so focus is still here.
    return () => {
      const active = dom.activeElement;
      const held = active && element.contains(active) ? active.getAttribute("aria-label") : null;
      if (held === null) return;
      handedOff.set(dom, held);
      dom.window.requestAnimationFrame(() => {
        if (handedOff.get(dom) !== held) return;
        handedOff.delete(dom);
        const active = dom.activeElement;
        if (active === null || active === dom.document.body) focusDock(dom);
      });
    };
  }, [dom, nav]);
}
