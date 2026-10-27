import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";

import type { TargetSurface } from "@/notebook/target-surface";
import type { ViewportPoint } from "@/notebook/types";

import { viewportToContent } from "@/selection/anchor";

export type SelectionMotion = "animate" | "instant";
export type RequestSheetTab = "open" | "history";

export type WorkflowState =
  | { mode: "idle" }
  | { mode: "armed"; activeTarget: TargetSurface | null }
  | {
      mode: "dragging";
      target: TargetSurface;
      pointerId: number;
      start: ViewportPoint;
      current: ViewportPoint;
    }
  | {
      mode: "editingNote";
      selectionId: string;
      motion: SelectionMotion;
      error?: string;
    };

export type UiState = {
  workflow: WorkflowState;
  pendingSelections: Selection[];
  optimisticCurrentSelectionId: string | null;
  busySelectionIds: ReadonlySet<string>;
  clearPending: boolean;
  sheetOpen: boolean;
  sheetTab: RequestSheetTab;
  focusedHistoryKey: string | null;
  /** History lists only the requests that shaped the current selection. */
  historyShapedOnly: boolean;
  announcement: string;
};

export type UiAction =
  | { type: "arm" }
  | { type: "disarm" }
  | { type: "toggleArm" }
  | { type: "focusTarget"; target: TargetSurface | null }
  | {
      type: "startDrag";
      target: TargetSurface;
      pointerId: number;
      point: ViewportPoint;
    }
  | { type: "moveDrag"; pointerId: number; point: ViewportPoint }
  | { type: "selectionQueued"; selection: Selection; motion?: SelectionMotion }
  /** The queued selection was committed or failed, as `announcement` says. */
  | { type: "selectionSettled"; selectionId: string; announcement: string }
  | { type: "selectionActivated"; selectionId: string }
  | { type: "activationSettled"; selectionId: string; failure?: string }
  | { type: "editNote"; selectionId: string; motion?: SelectionMotion }
  | { type: "closeNote" }
  | { type: "noteSaveSucceeded"; selectionId: string; label: string }
  | { type: "noteSaveFailed"; selectionId: string; message: string }
  | { type: "mutationStarted"; selectionId: string }
  | { type: "mutationFinished"; selectionId: string }
  | { type: "setClearPending"; pending: boolean }
  | { type: "historyReopened"; label: string }
  | { type: "setSheetTab"; tab: RequestSheetTab }
  /** Keep the tab a sheet fell through to when its own tab emptied. */
  | { type: "sheetFellThrough"; tab: RequestSheetTab }
  | { type: "openHistory"; key: string }
  | { type: "setShapedOnly"; enabled: boolean }
  | { type: "setSheetOpen"; open: boolean }
  | { type: "toggleSheet" }
  | { type: "announce"; message: string };

export const INITIAL_UI_STATE: UiState = {
  workflow: { mode: "idle" },
  pendingSelections: [],
  optimisticCurrentSelectionId: null,
  busySelectionIds: new Set(),
  clearPending: false,
  sheetOpen: false,
  sheetTab: "open",
  focusedHistoryKey: null,
  historyShapedOnly: false,
  announcement: "",
};

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "toggleArm":
      return uiReducer(
        state,
        state.workflow.mode === "armed" || state.workflow.mode === "dragging"
          ? { type: "disarm" }
          : { type: "arm" },
      );
    case "arm":
      return {
        ...state,
        workflow: { mode: "armed", activeTarget: null },
        sheetOpen: false,
        announcement: "Select mode active. Click a point or drag a region.",
      };
    case "disarm":
      return {
        ...state,
        workflow: { mode: "idle" },
        announcement: "Select mode closed.",
      };
    case "focusTarget":
      if (state.workflow.mode !== "armed") return state;
      if (
        state.workflow.activeTarget?.key === action.target?.key &&
        state.workflow.activeTarget?.element === action.target?.element
      ) {
        return state;
      }
      return {
        ...state,
        workflow: {
          ...state.workflow,
          activeTarget: action.target,
        },
      };
    case "startDrag":
      if (state.workflow.mode !== "armed") return state;
      return {
        ...state,
        workflow: {
          mode: "dragging",
          target: action.target,
          pointerId: action.pointerId,
          start: action.point,
          current: action.point,
        },
      };
    case "moveDrag":
      if (state.workflow.mode !== "dragging" || state.workflow.pointerId !== action.pointerId) {
        return state;
      }
      return {
        ...state,
        workflow: { ...state.workflow, current: action.point },
      };
    case "selectionQueued":
      return {
        ...state,
        workflow: {
          mode: "editingNote",
          selectionId: action.selection.id,
          motion: action.motion ?? "animate",
        },
        pendingSelections: [...state.pendingSelections, action.selection],
        optimisticCurrentSelectionId: action.selection.id,
        announcement: `${action.selection.label} selected.`,
      };
    case "selectionSettled":
      return {
        ...state,
        pendingSelections: state.pendingSelections.filter(({ id }) => id !== action.selectionId),
        optimisticCurrentSelectionId: releaseOptimistic(state, action.selectionId),
        announcement: action.announcement,
      };
    case "selectionActivated":
      return {
        ...state,
        optimisticCurrentSelectionId: action.selectionId,
      };
    case "activationSettled":
      return {
        ...state,
        optimisticCurrentSelectionId: releaseOptimistic(state, action.selectionId),
        announcement: action.failure ?? state.announcement,
      };
    case "editNote":
      return {
        ...state,
        workflow: {
          mode: "editingNote",
          selectionId: action.selectionId,
          motion: action.motion ?? "animate",
        },
        optimisticCurrentSelectionId: action.selectionId,
        sheetOpen: false,
      };
    case "closeNote":
      return { ...state, workflow: { mode: "idle" } };
    case "noteSaveSucceeded":
      return {
        ...state,
        workflow:
          state.workflow.mode === "editingNote" && state.workflow.selectionId === action.selectionId
            ? { mode: "idle" }
            : state.workflow,
        busySelectionIds: without(state.busySelectionIds, action.selectionId),
        optimisticCurrentSelectionId: releaseOptimistic(state, action.selectionId),
        announcement: `${action.label} note updated.`,
      };
    case "noteSaveFailed":
      return {
        ...state,
        workflow:
          state.workflow.mode === "editingNote" && state.workflow.selectionId === action.selectionId
            ? { ...state.workflow, error: action.message }
            : state.workflow,
        busySelectionIds: without(state.busySelectionIds, action.selectionId),
        announcement: action.message,
      };
    case "mutationStarted":
      return {
        ...state,
        busySelectionIds: new Set(state.busySelectionIds).add(action.selectionId),
      };
    case "mutationFinished":
      return {
        ...state,
        busySelectionIds: without(state.busySelectionIds, action.selectionId),
      };
    case "setClearPending":
      return { ...state, clearPending: action.pending };
    case "historyReopened":
      return {
        ...state,
        sheetTab: "open",
        focusedHistoryKey: null,
        announcement: `${action.label} reopened.`,
      };
    case "setSheetTab":
      return {
        ...state,
        sheetTab: action.tab,
        focusedHistoryKey: null,
      };
    case "sheetFellThrough":
      return { ...state, sheetTab: action.tab };
    case "openHistory":
      return {
        ...state,
        sheetOpen: true,
        sheetTab: "history",
        focusedHistoryKey: action.key,
        historyShapedOnly: false,
      };
    case "setShapedOnly":
      return { ...state, historyShapedOnly: action.enabled };
    case "setSheetOpen":
      return { ...state, sheetOpen: action.open };
    // The sheet opens on Open, where the current selection is. With nothing
    // open it shows History instead.
    case "toggleSheet":
      return state.sheetOpen
        ? { ...state, sheetOpen: false }
        : { ...state, sheetOpen: true, sheetTab: "open", focusedHistoryKey: null };
    case "announce":
      return { ...state, announcement: action.message };
  }
}

export function previewAnchor(workflow: WorkflowState): SelectionAnchor | null {
  if (workflow.mode !== "dragging") return null;
  return gestureAnchor(workflow.target.element, workflow.start, workflow.current);
}

export function gestureAnchor(
  output: HTMLElement,
  start: ViewportPoint,
  end: ViewportPoint,
): SelectionAnchor {
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = Math.abs(end.y - start.y);
  const first = viewportToContent(output, start.x, start.y);
  if (deltaX < 5 || deltaY < 5) return { kind: "point", ...first };
  const last = viewportToContent(output, end.x, end.y);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  if (width === 0 || height === 0) return { kind: "point", ...first };
  return {
    kind: "rect",
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width,
    height,
  };
}

/** Drop the optimistic current selection once `selectionId` settles, unless another took its place. */
function releaseOptimistic(state: UiState, selectionId: string): string | null {
  return state.optimisticCurrentSelectionId === selectionId
    ? null
    : state.optimisticCurrentSelectionId;
}

function without(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}
