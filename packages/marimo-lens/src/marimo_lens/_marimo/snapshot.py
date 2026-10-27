"""Snapshot the notebook's cells and dataflow graph from the running marimo kernel."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .._notebook.provenance import MAX_RELEVANT_CELLS
from .._notebook.snapshot import (
    MAX_REPORTED_OMITTED_CELL_IDS,
    RuntimeCell,
    RuntimeCellStatus,
    RuntimeSnapshot,
    upstream_order,
)
from .controls import collect_controls
from .kernel import (
    RuntimeReadError,
    graph_lock,
    read_runtime_attribute,
    runtime_context,
    runtime_globals,
)


def collect_runtime_snapshot(
    output_cell_ids: Sequence[str] | None = None,
) -> RuntimeSnapshot:
    """Read cells, lineage, and relevant controls from the marimo kernel."""

    try:
        from marimo._runtime.context.types import ContextNotInitializedError
    except ImportError:
        return _unavailable("marimo runtime is unavailable")

    try:
        context = runtime_context()
    except RuntimeReadError as error:
        if isinstance(error.source, ImportError):
            return _unavailable("marimo runtime is unavailable")
        if not isinstance(error.source, ContextNotInitializedError):
            return _unavailable(str(error))
        return _unavailable("not running in a marimo kernel")

    graph = getattr(context, "graph", None)
    if graph is None:
        return _unavailable("marimo runtime has no dataflow graph")

    with graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return _unavailable("marimo dataflow graph has no cells")
        cell_items = tuple(raw_cells.items())
        cell_ids = [str(cell_id) for cell_id, _cell in cell_items]
        cell_order = {cell_id: index for index, cell_id in enumerate(cell_ids)}
        parents = graph_parents(graph, cell_ids, cell_order)
        requested_output_ids = _unique_existing_ids(
            cell_ids if output_cell_ids is None else output_cell_ids,
            available_ids=set(cell_ids),
        )
        priority = upstream_order(requested_output_ids, parents)
        retained_ids = priority[:MAX_RELEVANT_CELLS]
        retained_id_set = set(retained_ids)
        omitted_ids = priority[MAX_RELEVANT_CELLS:]
        cells = tuple(
            runtime_cell(
                str(cell_id),
                cell,
                upstream_cell_ids=parents.get(str(cell_id), ()),
            )
            for cell_id, cell in cell_items
            if str(cell_id) in retained_id_set
        )
        definitions = _definitions(cells)
        omitted_id_set = set(omitted_ids)
        cell_truncated_output_ids = frozenset(
            output_id
            for output_id in requested_output_ids
            if _closure_intersects(output_id, parents, omitted_id_set)
        )
    namespace, namespace_complete = runtime_globals(context)
    (
        controls,
        control_truncated_output_ids,
        control_incomplete_output_ids,
    ) = collect_controls(
        namespace,
        definitions,
        cells=cells,
        output_cell_ids=tuple(
            output_id
            for output_id in requested_output_ids
            if output_id in retained_id_set
        ),
    )
    return RuntimeSnapshot(
        available=True,
        filename=str(getattr(context, "filename", "") or ""),
        reason="",
        available_cell_ids=frozenset(requested_output_ids),
        cells=cells,
        controls=controls,
        omitted_cell_ids=tuple(omitted_ids[:MAX_REPORTED_OMITTED_CELL_IDS]),
        omitted_cell_count=len(omitted_ids),
        cell_truncated_output_ids=cell_truncated_output_ids,
        control_truncated_output_ids=control_truncated_output_ids,
        control_incomplete_output_ids=(
            control_incomplete_output_ids
            if namespace_complete
            else frozenset(
                output_id
                for output_id in requested_output_ids
                if output_id in retained_id_set
            )
        ),
    )


def _unique_existing_ids(
    values: Sequence[str],
    *,
    available_ids: set[str],
) -> tuple[str, ...]:
    result: list[str] = []
    for value in values:
        cell_id = str(value)
        if cell_id in available_ids and cell_id not in result:
            result.append(cell_id)
    return tuple(result)


def _closure_intersects(
    output_cell_id: str,
    parents: Mapping[str, tuple[str, ...]],
    targets: set[str],
) -> bool:
    if not targets:
        return False
    visited: set[str] = set()
    stack = [output_cell_id]
    while stack:
        cell_id = stack.pop()
        if cell_id in visited:
            continue
        if cell_id in targets:
            return True
        visited.add(cell_id)
        stack.extend(parents.get(cell_id, ()))
    return False


def runtime_cell_status(cell_id: str) -> RuntimeCellStatus:
    """Return exact cell membership from the active marimo graph."""

    try:
        context = runtime_context()
    except RuntimeReadError:
        return "unavailable"

    graph = getattr(context, "graph", None)
    if graph is None:
        return "unavailable"
    with graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return "unavailable"
        return "available" if cell_id in raw_cells else "missing"


def runtime_cell(
    cell_id: str,
    cell: Any,
    *,
    upstream_cell_ids: tuple[str, ...],
) -> RuntimeCell:
    code = str(getattr(cell, "code", "") or "")
    refs = tuple(sorted(str(name) for name in getattr(cell, "refs", ()) or ()))
    return RuntimeCell(
        id=cell_id,
        code=code,
        defs=tuple(sorted(str(name) for name in getattr(cell, "defs", ()) or ())),
        refs=refs,
        upstream_cell_ids=upstream_cell_ids,
        language=str(getattr(cell, "language", "python") or "python"),
        runtime_state=_optional_runtime_text(cell, "runtime_state"),
        run_result_status=_optional_runtime_text(cell, "run_result_status"),
        stale=_runtime_stale(cell),
    )


def _optional_runtime_text(cell: Any, name: str) -> str | None:
    # Runtime cells are host-owned and may expose descriptors that raise.
    try:
        value = read_runtime_attribute(cell, name)
    except RuntimeReadError:
        return None
    return str(value) if value is not None else None


def _runtime_stale(cell: Any) -> bool | None:
    # Runtime cells are host-owned and may expose descriptors that raise.
    try:
        value = read_runtime_attribute(cell, "stale")
    except RuntimeReadError:
        return None
    return value if isinstance(value, bool) else None


def _definitions(cells: Sequence[RuntimeCell]) -> dict[str, tuple[str, ...]]:
    result: dict[str, list[str]] = {}
    for cell in cells:
        for name in cell.defs:
            result.setdefault(name, []).append(cell.id)
    return {name: tuple(cell_ids) for name, cell_ids in result.items()}


def graph_parents(
    graph: Any,
    cell_ids: Sequence[str],
    cell_order: Mapping[str, int],
) -> dict[str, tuple[str, ...]]:
    fallback_order = len(cell_order)
    raw_parents = getattr(graph, "parents", None)
    if isinstance(raw_parents, Mapping):
        return {
            cell_id: tuple(
                sorted(
                    (str(parent) for parent in raw_parents.get(cell_id, ())),
                    key=lambda parent: (
                        cell_order.get(parent, fallback_order),
                        parent,
                    ),
                )
            )
            for cell_id in cell_ids
        }

    result: dict[str, list[str]] = {cell_id: [] for cell_id in cell_ids}
    raw_children = getattr(graph, "children", {})
    if isinstance(raw_children, Mapping):
        for parent, children in raw_children.items():
            parent_id = str(parent)
            for child in children:
                result.setdefault(str(child), []).append(parent_id)
    return {
        cell_id: tuple(
            sorted(
                parent_ids,
                key=lambda parent: (cell_order.get(parent, fallback_order), parent),
            )
        )
        for cell_id, parent_ids in result.items()
    }


def _unavailable(reason: str) -> RuntimeSnapshot:
    return RuntimeSnapshot(
        available=False,
        filename="",
        reason=reason,
        available_cell_ids=frozenset(),
        cells=(),
        controls=(),
    )
