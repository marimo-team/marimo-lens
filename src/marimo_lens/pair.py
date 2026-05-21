"""Public marimo-pair feedback and receipt protocol namespace."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypeAlias

from ._contract import (
    AgentActivityKind,
    AgentCellMarkKind,
    AgentFinishStatus,
    AnnotationStatus,
)
from ._pair_feedback import build_pair_feedback, render_markdown, render_pair_prompt
from .agent_activity import (
    AGENT_ACTIVITY_KINDS,
    AGENT_ACTIVITY_PROTOCOL,
    AGENT_ACTIVITY_VERSION,
    ANNOTATION_STATUSES,
    CELL_MARK_KINDS,
    DEFAULT_AGENT_LABEL,
    FINISH_STATUSES,
    PAIR_RESULT_PROTOCOL,
    PAIR_RESULT_VERSION,
    build_agent_finished,
    build_agent_started,
    build_annotation_status,
    build_cell_mark,
    build_focus_command,
    build_pair_result,
    render_pair_result_prompt,
)

PairFeedbackPacket: TypeAlias = Mapping[str, Any]
PairResultPacket: TypeAlias = Mapping[str, Any]
AgentActivityItem: TypeAlias = Mapping[str, Any]
AgentActivityTrail: TypeAlias = Sequence[AgentActivityItem]

__all__ = [
    "AGENT_ACTIVITY_KINDS",
    "AGENT_ACTIVITY_PROTOCOL",
    "AGENT_ACTIVITY_VERSION",
    "ANNOTATION_STATUSES",
    "CELL_MARK_KINDS",
    "DEFAULT_AGENT_LABEL",
    "FINISH_STATUSES",
    "PAIR_RESULT_PROTOCOL",
    "PAIR_RESULT_VERSION",
    "AgentActivityItem",
    "AgentActivityKind",
    "AgentActivityTrail",
    "AgentCellMarkKind",
    "AgentFinishStatus",
    "AnnotationStatus",
    "PairFeedbackPacket",
    "PairResultPacket",
    "build_agent_finished",
    "build_agent_started",
    "build_annotation_status",
    "build_cell_mark",
    "build_focus_command",
    "build_pair_feedback",
    "build_pair_result",
    "render_markdown",
    "render_pair_prompt",
    "render_pair_result_prompt",
]
