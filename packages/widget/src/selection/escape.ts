import type { UiAction, UiState } from "@/selection/state";

type EscapeController = {
  state: UiState;
  dispatch: (action: UiAction) => void;
  cancelDrag: (pointerId: number, output: HTMLElement) => void;
  cancelAdjustment: () => boolean;
  focusSelection: (selectionId: string) => void;
  focusDock: () => void;
  focusListTrigger: () => void;
};

export function handleLensEscape(event: KeyboardEvent, controller: EscapeController): boolean {
  if (event.key !== "Escape") return false;
  const workflow = controller.state.workflow;
  if (controller.cancelAdjustment()) {
    // The focused marker or resize handle remains the stable return target.
  } else if (workflow.mode === "editingNote") {
    controller.dispatch({ type: "closeNote" });
    controller.focusSelection(workflow.selectionId);
  } else if (controller.state.listOpen) {
    controller.dispatch({ type: "setListOpen", open: false });
    controller.focusListTrigger();
  } else if (workflow.mode === "armed" || workflow.mode === "dragging") {
    if (workflow.mode === "dragging") {
      controller.cancelDrag(workflow.pointerId, workflow.output.element);
    }
    controller.dispatch({ type: "disarm" });
    controller.focusDock();
  } else {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
