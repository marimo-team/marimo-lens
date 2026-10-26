"""Detached runtime records used by Lens context projection."""

from __future__ import annotations

import pathlib
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from .controls import RuntimeControl

MAX_REPORTED_OMITTED_CELL_IDS = 16


@dataclass(frozen=True, slots=True)
class RuntimeCell:
    id: str
    code: str
    defs: tuple[str, ...]
    refs: tuple[str, ...]
    upstream_cell_ids: tuple[str, ...]
    language: str
    runtime_state: str | None = None
    run_result_status: str | None = None
    stale: bool | None = None


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    available: bool
    filename: str
    reason: str
    available_cell_ids: frozenset[str]
    cells: tuple[RuntimeCell, ...]
    controls: tuple[RuntimeControl, ...]
    omitted_cell_ids: tuple[str, ...] = ()
    omitted_cell_count: int = 0
    cell_truncated_output_ids: frozenset[str] = frozenset()
    control_truncated_output_ids: frozenset[str] = frozenset()
    control_incomplete_output_ids: frozenset[str] = frozenset()


RuntimeCellStatus = Literal["available", "missing", "unavailable"]


def notebook_name(filename: str) -> str:
    return pathlib.Path(filename).name if filename else ""


def upstream_order(
    cell_ids: Sequence[str],
    parents_by_id: Mapping[str, Sequence[str]],
) -> list[str]:
    """Return ``cell_ids`` and their ancestors, nearest first."""

    order: list[str] = []
    queued: set[str] = set()
    queue: deque[str] = deque()
    for cell_id in cell_ids:
        if cell_id in parents_by_id and cell_id not in queued:
            queue.append(cell_id)
            queued.add(cell_id)
    while queue:
        cell_id = queue.popleft()
        order.append(cell_id)
        for parent_id in parents_by_id[cell_id]:
            if parent_id in parents_by_id and parent_id not in queued:
                queue.append(parent_id)
                queued.add(parent_id)
    return order
