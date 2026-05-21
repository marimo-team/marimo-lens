"""Canonical wire-contract vocabulary shared by Python and frontend tests."""

from __future__ import annotations

from typing import Literal, TypeAlias

TARGET_KINDS = (
    "anywidget",
    "data",
    "dataframe",
    "diagnostic",
    "document",
    "layout",
    "media",
    "object",
    "output",
    "table",
    "ui",
    "visualization",
)

CAPABILITY_KEYS = (
    "columnarDom",
    "columnarGrid",
    "data",
    "diagnostic",
    "document",
    "interactive",
    "chartPart",
    "media",
    "visualSurface",
)

SELECTION_SURFACES = (
    "chart-part",
    "columnar-dom",
    "columnar-grid",
    "display-cell",
    "document",
    "interactive",
    "marked",
    "media",
    "selector",
    "visual-surface",
)

SELECTION_GRANULARITIES = (
    "target",
    "surface",
    "group",
    "item",
    "datum",
)

CHART_PART_KINDS = (
    "annotation",
    "axis",
    "facet",
    "legend",
    "mark",
    "plot-area",
    "title",
    "trace",
)

FEEDBACK_INTENTS = (
    "fix",
    "question",
    "explain",
    "approve",
)

FEEDBACK_SEVERITIES = (
    "blocking",
    "important",
    "suggestion",
)

AGENT_ACTIVITY_KINDS = (
    "agent-started",
    "agent-finished",
    "cell-mark",
    "annotation-status",
)

AGENT_CELL_MARK_STATUSES = (
    "read",
    "claimed",
    "edited",
    "ran",
    "failed",
    "needs-review",
)

AGENT_ANNOTATION_STATUSES = (
    "in_progress",
    "addressed",
    "blocked",
    "needs_human",
)

AGENT_FINISH_STATUSES = (
    "completed",
    "blocked",
    "failed",
)

TARGET_CONTRACT_KEYS = (
    "capabilities",
    "cellId",
    "chart",
    "columns",
    "component",
    "codePreview",
    "defs",
    "displayCellIds",
    "entity",
    "extensions",
    "id",
    "kind",
    "label",
    "output",
    "outputRefs",
    "outputType",
    "pythonType",
    "refs",
    "relatedCellIds",
    "selectionModel",
    "selectionPolicy",
    "selectors",
    "shape",
    "summary",
    "variable",
)

TargetKind: TypeAlias = Literal[
    "anywidget",
    "data",
    "dataframe",
    "diagnostic",
    "document",
    "layout",
    "media",
    "object",
    "output",
    "table",
    "ui",
    "visualization",
]
SelectionSurface: TypeAlias = Literal[
    "chart-part",
    "columnar-dom",
    "columnar-grid",
    "display-cell",
    "document",
    "interactive",
    "marked",
    "media",
    "selector",
    "visual-surface",
]
SelectionGranularity: TypeAlias = Literal["target", "surface", "group", "item", "datum"]
ChartPartKind: TypeAlias = Literal[
    "annotation",
    "axis",
    "facet",
    "legend",
    "mark",
    "plot-area",
    "title",
    "trace",
]
FeedbackIntent: TypeAlias = Literal["fix", "question", "explain", "approve"]
FeedbackSeverity: TypeAlias = Literal["blocking", "important", "suggestion"]
AgentActivityKind: TypeAlias = Literal[
    "agent-started",
    "agent-finished",
    "cell-mark",
    "annotation-status",
]
AgentCellMarkKind: TypeAlias = Literal[
    "read",
    "claimed",
    "edited",
    "ran",
    "failed",
    "needs-review",
]
AnnotationStatus: TypeAlias = Literal[
    "in_progress",
    "addressed",
    "blocked",
    "needs_human",
]
AgentFinishStatus: TypeAlias = Literal["completed", "blocked", "failed"]

__all__ = [
    "AGENT_ACTIVITY_KINDS",
    "AGENT_ANNOTATION_STATUSES",
    "AGENT_CELL_MARK_STATUSES",
    "AGENT_FINISH_STATUSES",
    "CAPABILITY_KEYS",
    "CHART_PART_KINDS",
    "FEEDBACK_INTENTS",
    "FEEDBACK_SEVERITIES",
    "SELECTION_GRANULARITIES",
    "SELECTION_SURFACES",
    "TARGET_CONTRACT_KEYS",
    "TARGET_KINDS",
    "AgentActivityKind",
    "AgentCellMarkKind",
    "AgentFinishStatus",
    "AnnotationStatus",
    "ChartPartKind",
    "FeedbackIntent",
    "FeedbackSeverity",
    "SelectionGranularity",
    "SelectionSurface",
    "TargetKind",
]
