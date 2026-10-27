import { useEffect, useEffectEvent } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

export const LENS_SELECTION_SHORTCUT = "Alt+L";
export const LENS_SELECTION_SHORTCUT_LABEL = "Option/Alt+L";

export function useSelectionShortcut(disabled: boolean, onShortcut: () => void): void {
  const dom = useNotebookDom();
  const enterSelection = useEffectEvent((event: KeyboardEvent) => {
    if (!isLensSelectionShortcut(event) || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) onShortcut();
  });
  useEffect(() => {
    return dom.observeInteractionSurfaces(
      { includeTargetFrames: true, lockSelectionGestures: false },
      (surface) => {
        surface.document.addEventListener("keydown", enterSelection, true);
        return () => surface.document.removeEventListener("keydown", enterSelection, true);
      },
    );
  }, [dom]);
}

function isLensSelectionShortcut(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === "KeyL"
  );
}
