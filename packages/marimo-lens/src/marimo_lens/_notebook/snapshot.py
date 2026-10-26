"""Detached runtime records used by Lens context projection."""

from __future__ import annotations

import pathlib
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from .controls import RuntimeControl

MAX_NOTEBOOK_CELLS = 1_000
MAX_REPORTED_OMITTED_CELL_IDS = 16


@dataclass(frozen=True, slots=True)
class RuntimeCell:
    id: str
    code: str
    defs: tuple[str, ...]
    refs: tuple[str, ...]
    upstream_cell_ids: tuple[str, ...]
    language: str
    name: str | None = None
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
    # Cells in marimo's document whose code the kernel did not register, such
    # as code with a syntax error.
    unregistered: tuple[RuntimeCell, ...] = ()
    # Whether ``cells``, ``unregistered``, and ``unseen`` are every cell of the
    # document, so a cell missing from all three is deleted.
    document: bool = False
    # Cells the document may still hold whose code the snapshot cannot read.
    unseen: frozenset[str] = frozenset()
    omitted_cell_ids: tuple[str, ...] = ()
    omitted_cell_count: int = 0
    cell_truncated_output_ids: frozenset[str] = frozenset()
    control_truncated_output_ids: frozenset[str] = frozenset()
    control_incomplete_output_ids: frozenset[str] = frozenset()

    def notebook_cells(self) -> dict[str, RuntimeCell]:
        """Return registered and unregistered cells by ID, registered ones winning."""

        cells = {cell.id: cell for cell in self.unregistered}
        cells.update((cell.id, cell) for cell in self.cells)
        return cells


def cell_label(cell_id: str, cell: RuntimeCell | None, name: str | None = None) -> str:
    """Name a cell for an agent: its ID, with its name or else the names it defines.

    ``name`` stands in when the snapshot has no name for the cell, such as a
    name the record kept.
    """

    name = (cell.name if cell else None) or name
    if name:
        return f"`{cell_id}` ({name})"
    defs = cell.defs if cell else ()
    if defs:
        shown = ", ".join(defs[:3]) + (", ..." if len(defs) > 3 else "")
        return f"`{cell_id}` (defines {shown})"
    return f"`{cell_id}`"


RuntimeCellStatus = Literal["available", "missing", "unavailable"]
CellState = Literal["idle", "stale", "failed", "queued", "running", "disabled"]


def cell_state(cell: RuntimeCell) -> CellState:
    """Return how far a cell's output reflects its current code."""

    if cell.runtime_state in {"queued", "running"}:
        return "queued" if cell.runtime_state == "queued" else "running"
    if (
        cell.runtime_state == "disabled-transitively"
        or cell.run_result_status == "disabled"
    ):
        return "disabled"
    if cell.stale:
        return "stale"
    if cell.run_result_status in {
        "exception",
        "marimo-error",
        "interrupted",
        "cancelled",
    }:
        return "failed"
    return "idle"


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


def cell_name(value: object) -> str | None:
    """Return a cell's name as the notebook shows it, or None for an unnamed cell.

    marimo stores a top-level function or class cell under its name with a
    ``*`` prefix, which is no name a person or agent writes.
    """

    if not isinstance(value, str):
        return None
    name = value.removeprefix("*")
    return name if name not in {"", "_", "__"} else None
