import type { Selection, SelectionAnchor } from "@/contracts";
import type { OutputCell, ViewportPoint } from "@/types";

export type SelectionMotion = "animate" | "instant";

export type PendingSelection = {
  selection: Selection;
};

export type WorkflowState =
  | { mode: "idle" }
  | { mode: "armed"; activeOutputCellId: string | null }
  | {
      mode: "dragging";
      output: OutputCell;
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

export type ExportState =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "success" }
  | { status: "error"; message: string };

export type UiState = {
  workflow: WorkflowState;
  pendingSelections: PendingSelection[];
  optimisticCurrentSelectionId: string | null;
  busySelectionIds: string[];
  clearPending: boolean;
  listOpen: boolean;
  menuOpen: boolean;
  export: ExportState;
  announcement: string;
};

export type UiAction =
  | { type: "arm" }
  | { type: "disarm" }
  | { type: "focusOutput"; outputCellId: string | null }
  | {
      type: "startDrag";
      output: OutputCell;
      pointerId: number;
      point: ViewportPoint;
    }
  | { type: "moveDrag"; pointerId: number; point: ViewportPoint }
  | { type: "selectionQueued"; pending: PendingSelection }
  | { type: "selectionCommitted"; selectionId: string; label: string }
  | { type: "selectionFailed"; selectionId: string; message: string }
  | { type: "selectionActivated"; selectionId: string }
  | { type: "activationCommitted"; selectionId: string }
  | { type: "activationFailed"; selectionId: string; message: string }
  | { type: "editNote"; selectionId: string; motion?: SelectionMotion }
  | { type: "closeNote" }
  | { type: "noteSaveStarted"; selectionId: string }
  | { type: "noteSaveSucceeded"; selectionId: string; label: string }
  | { type: "noteSaveFailed"; selectionId: string; message: string }
  | { type: "mutationStarted"; selectionId: string }
  | { type: "mutationFinished"; selectionId: string }
  | { type: "clearStarted" }
  | { type: "clearFinished" }
  | { type: "setListOpen"; open: boolean }
  | { type: "setMenuOpen"; open: boolean }
  | { type: "exportStarted"; message: string }
  | { type: "exportSucceeded"; message: string }
  | { type: "exportFailed"; message: string }
  | { type: "announce"; message: string };

export const INITIAL_UI_STATE: UiState = {
  workflow: { mode: "idle" },
  pendingSelections: [],
  optimisticCurrentSelectionId: null,
  busySelectionIds: [],
  clearPending: false,
  listOpen: false,
  menuOpen: false,
  export: { status: "idle" },
  announcement: "",
};

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "arm":
      return {
        ...state,
        workflow: { mode: "armed", activeOutputCellId: null },
        listOpen: false,
        menuOpen: false,
        announcement: "Select mode active. Click a point or drag a region.",
      };
    case "disarm":
      return {
        ...state,
        workflow: { mode: "idle" },
        announcement: "Select mode closed.",
      };
    case "focusOutput":
      if (state.workflow.mode !== "armed") return state;
      return {
        ...state,
        workflow: {
          ...state.workflow,
          activeOutputCellId: action.outputCellId,
        },
      };
    case "startDrag":
      if (state.workflow.mode !== "armed") return state;
      return {
        ...state,
        workflow: {
          mode: "dragging",
          output: action.output,
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
        workflow: { mode: "idle" },
        pendingSelections: [...state.pendingSelections, action.pending],
        optimisticCurrentSelectionId: action.pending.selection.id,
        announcement: `${action.pending.selection.label} selected.`,
      };
    case "selectionCommitted":
      return {
        ...state,
        pendingSelections: state.pendingSelections.filter(
          ({ selection }) => selection.id !== action.selectionId,
        ),
        optimisticCurrentSelectionId:
          state.optimisticCurrentSelectionId === action.selectionId
            ? null
            : state.optimisticCurrentSelectionId,
        announcement: `${action.label} selected.`,
      };
    case "selectionFailed":
      return {
        ...state,
        pendingSelections: state.pendingSelections.filter(
          ({ selection }) => selection.id !== action.selectionId,
        ),
        optimisticCurrentSelectionId:
          state.optimisticCurrentSelectionId === action.selectionId
            ? null
            : state.optimisticCurrentSelectionId,
        announcement: action.message,
      };
    case "selectionActivated":
      return {
        ...state,
        optimisticCurrentSelectionId: action.selectionId,
      };
    case "activationCommitted":
      return {
        ...state,
        optimisticCurrentSelectionId:
          state.optimisticCurrentSelectionId === action.selectionId
            ? null
            : state.optimisticCurrentSelectionId,
      };
    case "activationFailed":
      return {
        ...state,
        optimisticCurrentSelectionId:
          state.optimisticCurrentSelectionId === action.selectionId
            ? null
            : state.optimisticCurrentSelectionId,
        announcement: action.message,
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
        listOpen: false,
        menuOpen: false,
      };
    case "closeNote":
      return { ...state, workflow: { mode: "idle" } };
    case "noteSaveStarted":
      return {
        ...state,
        busySelectionIds: addUnique(state.busySelectionIds, action.selectionId),
      };
    case "noteSaveSucceeded":
      return {
        ...state,
        workflow: { mode: "idle" },
        busySelectionIds: removeValue(state.busySelectionIds, action.selectionId),
        optimisticCurrentSelectionId:
          state.optimisticCurrentSelectionId === action.selectionId
            ? null
            : state.optimisticCurrentSelectionId,
        announcement: `${action.label} note updated.`,
      };
    case "noteSaveFailed":
      return {
        ...state,
        workflow: {
          mode: "editingNote",
          selectionId: action.selectionId,
          motion: "instant",
          error: action.message,
        },
        busySelectionIds: removeValue(state.busySelectionIds, action.selectionId),
        announcement: action.message,
      };
    case "mutationStarted":
      return {
        ...state,
        busySelectionIds: addUnique(state.busySelectionIds, action.selectionId),
      };
    case "mutationFinished":
      return {
        ...state,
        busySelectionIds: removeValue(state.busySelectionIds, action.selectionId),
      };
    case "clearStarted":
      return { ...state, clearPending: true, menuOpen: false };
    case "clearFinished":
      return { ...state, clearPending: false };
    case "setListOpen":
      return { ...state, listOpen: action.open, menuOpen: false };
    case "setMenuOpen":
      return { ...state, menuOpen: action.open, listOpen: false };
    case "exportStarted":
      return {
        ...state,
        export: { status: "exporting" },
        announcement: action.message,
      };
    case "exportSucceeded":
      return {
        ...state,
        export: { status: "success" },
        announcement: action.message,
      };
    case "exportFailed":
      return {
        ...state,
        export: { status: "error", message: action.message },
        announcement: action.message,
      };
    case "announce":
      return { ...state, announcement: action.message };
  }
}

export function locksCompetingInteractions(state: UiState): boolean {
  return state.clearPending || state.workflow.mode === "editingNote";
}

export function previewAnchor(workflow: WorkflowState): SelectionAnchor | null {
  if (workflow.mode !== "dragging") return null;
  return gestureAnchor(workflow.output.element, workflow.start, workflow.current);
}

export function gestureAnchor(
  output: HTMLElement,
  start: ViewportPoint,
  end: ViewportPoint,
): SelectionAnchor {
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = Math.abs(end.y - start.y);
  const first = normalizedPoint(output, start);
  if (deltaX < 5 || deltaY < 5) return { kind: "point", ...first };
  const last = normalizedPoint(output, end);
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

export function normalizedPoint(output: HTMLElement, point: ViewportPoint): ViewportPoint {
  const rect = output.getBoundingClientRect();
  const width = Math.max(output.scrollWidth, rect.width, 1);
  const height = Math.max(output.scrollHeight, rect.height, 1);
  return {
    x: clamp((point.x - rect.left + output.scrollLeft) / width, 0, 1),
    y: clamp((point.y - rect.top + output.scrollTop) / height, 0, 1),
  };
}

function addUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function removeValue(values: string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
