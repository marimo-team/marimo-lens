"""Detached runtime records used by Lens context projection."""

from __future__ import annotations

import pathlib
from dataclasses import dataclass
from typing import Literal

from ._control_state import RuntimeControl


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


__all__ = [
    "RuntimeCell",
    "RuntimeCellStatus",
    "RuntimeSnapshot",
]
