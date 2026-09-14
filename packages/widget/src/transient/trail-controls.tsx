import type { KeyboardEvent } from "react";

import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { TrailNavigation } from "@/transient/target-attention";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { focusDock } from "@/ui/focus";

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
    <nav className="ml-trail-controls" aria-label="Walkthrough steps" data-marimo-lens-ui>
      <button
        className="ml-icon-button"
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
      <span className="ml-trail-controls__count">
        {trail.index + 1} / {trail.count}
      </span>
      <button
        className="ml-icon-button"
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
      <button
        className="ml-icon-button"
        type="button"
        aria-label="End trail"
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
