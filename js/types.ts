import type {
  LensAnnotation,
  LensChartPart,
  LensColumn,
  LensTarget,
  NotebookGraph,
  SelectionGranularity,
  SelectionSurface,
  SerializedSemanticSelection,
} from "@/contracts";

export type LensTheme = "dark" | "light";

export type {
  AgentActivity,
  AgentActivityKind,
  AgentCellMarkKind,
  AgentCommand,
  DomEvidence,
  LensAnnotation,
  LensAnnotationAnchor,
  LensChartLibrary,
  LensChartMetadata,
  LensChartPart,
  LensChartPartKind,
  LensColumn,
  LensTarget,
  LensTargetKind,
  NotebookGraph,
  PairFeedback,
  PairFeedbackAnnotation,
  PairResult,
  RefreshState,
  RuntimeControl,
  RuntimeControlKind,
  SelectionGranularity,
  SelectionModel,
  SelectionModelUnit,
  SelectionSurface,
  SerializedSelectionEvidence,
  SerializedSemanticSelection,
} from "@/contracts";

export type SelectionEvidence = {
  kind: string;
  hitKind?: string;
  selector?: string;
  elementName?: string;
  column?: string;
  rowIndex?: number;
  data?: Record<string, unknown>;
  element?: Element;
};

export type SelectionHighlight =
  | {
      kind: "element";
      element: Element;
      padding?: number;
      strategy?: string;
    }
  | {
      kind: "elements";
      elements: Element[];
      fallbackElement?: Element;
      padding?: number;
      strategy?: string;
    }
  | {
      kind: "rect";
      rect: DOMRect;
      padding?: number;
      strategy?: string;
    };

export type SelectionAnchorSpec = {
  element?: Element;
  rootCellId?: string | null;
  selector?: string;
  point?: ViewportPoint;
  data?: Record<string, unknown>;
};

export type LensAnchorPathStep = {
  selector: string;
  shadow?: boolean;
};

export type SemanticSelection = {
  id: string;
  targetId: string;
  kind: string;
  granularity: SelectionGranularity;
  label: string;
  parentId?: string;
  data?: Record<string, unknown>;
  evidence: SelectionEvidence[];
  highlight: SelectionHighlight;
  anchor: SelectionAnchorSpec;
};

export type ResolvedHover = {
  element: Element;
  rect: DOMRect;
  target: LensTarget;
  semanticSelection: SemanticSelection;
  column?: LensColumn;
  chartPart?: LensChartPart | null;
  displayCellId?: string | null;
  elementName: string;
  elementPath: string;
  selection?: {
    adapter: SelectionSurface;
    kind: string;
    source?: string;
    score?: number;
  };
  context?: Record<string, unknown>;
};

export type PopupState = {
  hover: ResolvedHover;
  x: number;
  y: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export type DockPosition = {
  x: number;
  y: number;
};

export const EMPTY_GRAPH: NotebookGraph = {};

export type AnnotationDraft = Omit<LensAnnotation, "id" | "createdAt">;

export type SerializedSelectionSnapshot = SerializedSemanticSelection;
