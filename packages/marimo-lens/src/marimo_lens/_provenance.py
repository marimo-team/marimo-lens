"""Resolve producing cells to bounded marimo DAG provenance."""

from __future__ import annotations

import heapq
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ._protocol_models import (
    NONNEGATIVE_SAFE_INTEGER_ADAPTER,
    POSITIVE_SAFE_INTEGER_ADAPTER,
)

if TYPE_CHECKING:
    from ._control_state import RuntimeControl
    from ._runtime import RuntimeCell, RuntimeSnapshot

MAX_RELEVANT_CELLS = 64
MAX_TEXT_SOURCE_CHARACTERS = 24_000
MAX_REPORTED_OMITTED_CELL_IDS = 16

_ROLE_ORDER = {
    "producer": 0,
    "upstream": 1,
}


@dataclass(frozen=True, slots=True)
class ProvenanceCell:
    cell: RuntimeCell
    roles: tuple[str, ...]
    code: str


@dataclass(frozen=True, slots=True)
class Provenance:
    cells: tuple[ProvenanceCell, ...]
    referenced_names: frozenset[str]
    omitted_cell_ids: tuple[str, ...]
    omitted_cell_count: int
    truncated_cell_ids: tuple[str, ...]


def resolve_provenance(
    snapshot: RuntimeSnapshot,
    producer_cell_ids: Sequence[str],
    *,
    max_cells: int = MAX_RELEVANT_CELLS,
    max_source_characters: int = MAX_TEXT_SOURCE_CHARACTERS,
) -> Provenance:
    """Return producing cells and their bounded upstream closure."""

    max_cells = POSITIVE_SAFE_INTEGER_ADAPTER.validate_python(max_cells)
    max_source_characters = NONNEGATIVE_SAFE_INTEGER_ADAPTER.validate_python(
        max_source_characters
    )

    cells_by_id = {cell.id: cell for cell in snapshot.cells}
    cell_order = {cell.id: index for index, cell in enumerate(snapshot.cells)}
    output_ids = _unique(producer_cell_ids)
    roles: dict[str, set[str]] = {}
    output_core_ids: list[str] = []

    for output_id in output_ids:
        output_cell = cells_by_id.get(output_id)
        if output_cell is None:
            continue
        _append_unique(output_core_ids, output_id)
        roles.setdefault(output_id, set()).add("producer")

    # Producing cells are mandatory evidence. Transitive parents use the
    # remaining context budget when many producers are selected.
    priority = _upstream_priority(
        output_core_ids,
        {cell_id: cell.upstream_cell_ids for cell_id, cell in cells_by_id.items()},
    )
    priority_set = set(priority)
    for cell_id in priority:
        for parent_id in cells_by_id[cell_id].upstream_cell_ids:
            if parent_id in priority_set:
                roles.setdefault(parent_id, set()).add("upstream")
    selected_ids = priority[:max_cells]
    referenced_names = frozenset(
        name for cell_id in priority for name in cells_by_id[cell_id].refs
    )
    local_omitted = priority[max_cells:]
    snapshot_omissions_apply = bool(
        set(output_ids).intersection(snapshot.cell_truncated_output_ids)
    )
    snapshot_omitted_count = (
        snapshot.omitted_cell_count if snapshot_omissions_apply else 0
    )
    snapshot_omitted_ids = snapshot.omitted_cell_ids if snapshot_omissions_apply else ()
    omitted_cell_count = len(local_omitted) + snapshot_omitted_count
    omitted_ids = tuple(
        (*local_omitted, *snapshot_omitted_ids)[:MAX_REPORTED_OMITTED_CELL_IDS]
    )
    selected = set(selected_ids)
    topological_ids = _topological_order(selected, cells_by_id, cell_order)

    remaining_source = max_source_characters
    code_by_id: dict[str, str] = {}
    truncated_cell_ids: list[str] = []
    # Allocate source budget by relevance so a producer keeps its
    # source when a large distant ancestor consumes the remaining budget.
    for cell_id in selected_ids:
        code = cells_by_id[cell_id].code
        if len(code) <= remaining_source:
            code_by_id[cell_id] = code
            remaining_source -= len(code)
            continue
        code_by_id[cell_id] = code[:remaining_source]
        remaining_source = 0
        truncated_cell_ids.append(cell_id)

    cells = tuple(
        ProvenanceCell(
            cell=cells_by_id[cell_id],
            roles=tuple(
                sorted(
                    roles.get(cell_id, {"upstream"}),
                    key=lambda role: _ROLE_ORDER[role],
                )
            ),
            code=code_by_id[cell_id],
        )
        for cell_id in topological_ids
    )
    return Provenance(
        cells=cells,
        referenced_names=referenced_names,
        omitted_cell_ids=omitted_ids,
        omitted_cell_count=omitted_cell_count,
        truncated_cell_ids=tuple(truncated_cell_ids),
    )


def rank_relevant_controls(
    snapshot: RuntimeSnapshot,
    provenance: Provenance,
    producer_cell_ids: Sequence[str],
) -> tuple[RuntimeControl, ...]:
    """Return controls ordered by their relevance to producing cells."""

    output_id_set = set(producer_cell_ids)
    distances = _upstream_distances(snapshot, producer_cell_ids)
    cells_by_id = {cell.id: cell for cell in snapshot.cells}
    ranked: list[tuple[tuple[int, int, int], RuntimeControl]] = []
    fallback = len(snapshot.cells) + 1

    for runtime_order, control in enumerate(snapshot.controls):
        direct = bool(output_id_set.intersection(control.cell_ids))
        if not direct and control.name not in provenance.referenced_names:
            continue
        reference_distance = min(
            (
                distance
                for cell_id, distance in distances.items()
                if control.name in cells_by_id[cell_id].refs
            ),
            default=fallback,
        )
        rank = (0 if direct else 1, reference_distance, runtime_order)
        ranked.append((rank, control))

    ranked.sort(key=lambda item: item[0])
    return tuple(control for _rank, control in ranked)


def _upstream_distances(
    snapshot: RuntimeSnapshot,
    producer_cell_ids: Sequence[str],
) -> dict[str, int]:
    cells_by_id = {cell.id: cell for cell in snapshot.cells}
    distances: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque(
        (cell_id, 0) for cell_id in producer_cell_ids if cell_id in cells_by_id
    )
    while queue:
        cell_id, distance = queue.popleft()
        previous = distances.get(cell_id)
        if previous is not None and previous <= distance:
            continue
        distances[cell_id] = distance
        queue.extend(
            (parent_id, distance + 1)
            for parent_id in cells_by_id[cell_id].upstream_cell_ids
            if parent_id in cells_by_id
        )
    return distances


def _upstream_priority(
    core_ids: Sequence[str],
    parents_by_id: dict[str, tuple[str, ...]],
) -> list[str]:
    priority: list[str] = []
    queued: set[str] = set()
    queue: deque[str] = deque()
    for cell_id in core_ids:
        if cell_id in parents_by_id and cell_id not in queued:
            queue.append(cell_id)
            queued.add(cell_id)

    while queue:
        cell_id = queue.popleft()
        priority.append(cell_id)
        for parent_id in parents_by_id[cell_id]:
            if parent_id not in parents_by_id:
                continue
            if parent_id in queued:
                continue
            queue.append(parent_id)
            queued.add(parent_id)
    return priority


def _topological_order(
    selected: set[str],
    cells_by_id: dict[str, RuntimeCell],
    cell_order: dict[str, int],
) -> list[str]:
    fallback = len(cell_order)
    indegree = {
        cell_id: sum(
            parent in selected for parent in cells_by_id[cell_id].upstream_cell_ids
        )
        for cell_id in selected
    }
    children: dict[str, list[str]] = {cell_id: [] for cell_id in selected}
    for child_id in selected:
        for parent_id in cells_by_id[child_id].upstream_cell_ids:
            if parent_id in selected:
                children[parent_id].append(child_id)

    ready = [
        (cell_order.get(cell_id, fallback), cell_id)
        for cell_id, degree in indegree.items()
        if degree == 0
    ]
    heapq.heapify(ready)
    ordered: list[str] = []
    while ready:
        _rank, cell_id = heapq.heappop(ready)
        ordered.append(cell_id)
        for child_id in children[cell_id]:
            indegree[child_id] -= 1
            if indegree[child_id] == 0:
                heapq.heappush(
                    ready,
                    (cell_order.get(child_id, fallback), child_id),
                )

    if len(ordered) != len(selected):
        ordered.extend(
            sorted(
                selected - set(ordered),
                key=lambda cell_id: (cell_order.get(cell_id, fallback), cell_id),
            )
        )
    return ordered


def _unique(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        _append_unique(result, value)
    return result


def _append_unique(values: list[str], value: str) -> None:
    if value not in values:
        values.append(value)


__all__ = [
    "Provenance",
    "ProvenanceCell",
    "rank_relevant_controls",
    "resolve_provenance",
]
