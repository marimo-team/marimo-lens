"""Adapt private marimo runtime state into detached Lens records."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from typing import Any, cast

from . import _control_state, _marimo_control_state
from ._provenance import (
    MAX_RELEVANT_CELLS,
    MAX_REPORTED_OMITTED_CELL_IDS,
    _upstream_priority,
)
from ._runtime import RuntimeCell, RuntimeCellStatus, RuntimeSnapshot


class MarimoRuntimeAdapter:
    """Read the active marimo kernel into detached Lens values."""

    __slots__ = ()

    def snapshot(
        self,
        output_cell_ids: Sequence[str] | None = None,
    ) -> RuntimeSnapshot:
        return collect_runtime_snapshot(output_cell_ids)

    def cell_status(self, cell_id: str) -> RuntimeCellStatus:
        return runtime_cell_status(cell_id)

    def observe_cells(
        self, cell_ids: Sequence[str], on_change: Callable[[], None]
    ) -> Callable[[], None] | None:
        """Invalidate a consumer when a referenced cell's lifecycle ends."""
        try:
            from marimo._runtime.cell_lifecycle_item import CellLifecycleItem
            from marimo._runtime.context import get_context

            context = _read_runtime_context(get_context)
        except (ImportError, _RuntimeReadError):
            return None
        registry = getattr(context, "cell_lifecycle_registry", None)
        if registry is None:
            return None
        active = True

        class Watch(CellLifecycleItem):
            def create(self, context: Any) -> None:
                pass

            def dispose(self, context: Any, deletion: bool) -> bool:
                if active:
                    release()
                    on_change()
                return True

        watches = {cell_id: Watch() for cell_id in dict.fromkeys(cell_ids)}

        def release() -> None:
            nonlocal active
            active = False
            for cell_id, watch in watches.items():
                members = registry.registry.get(cell_id)
                if members is not None:
                    # Disposal may be iterating this set. Keep its iterator and
                    # key alive until the host finishes the lifecycle callback.
                    registry.registry[cell_id] = members - {watch}

        for cell_id, watch in watches.items():
            registry.inject(cell_id, watch)
        return release


def current_runtime_scope() -> object | None:
    """Return the active marimo UI registry as an opaque runtime identity."""

    try:
        from marimo._runtime.context import get_context
    except ImportError:
        return None

    try:
        context = _read_runtime_context(get_context)
        return _read_runtime_attribute(context, "ui_element_registry")
    except _RuntimeReadError:
        return None


def current_cell_id() -> str | None:
    """Return the ID of the notebook cell that is executing, if any."""

    try:
        from marimo._runtime.context import get_context
    except ImportError:
        return None

    try:
        context = _read_runtime_context(get_context)
        execution = _read_runtime_attribute(context, "execution_context")
        cell_id = _read_runtime_attribute(execution, "cell_id")
    except _RuntimeReadError:
        return None
    return str(cell_id) if cell_id is not None else None


class _RuntimeReadError(RuntimeError):
    """A host-owned runtime value could not be read."""

    def __init__(self, source: Exception) -> None:
        self.source = source
        name = type(source).__name__
        detail = source.args[0] if len(source.args) == 1 else None
        super().__init__(f"{name}: {detail}" if isinstance(detail, str) else name)


def collect_runtime_snapshot(
    output_cell_ids: Sequence[str] | None = None,
) -> RuntimeSnapshot:
    """Read cells, lineage, and relevant controls from the marimo kernel."""

    try:
        from marimo._runtime.context import get_context
        from marimo._runtime.context.types import ContextNotInitializedError
    except ImportError:
        return _unavailable("marimo runtime is unavailable")

    try:
        context = _read_runtime_context(get_context)
    except _RuntimeReadError as error:
        if not isinstance(error.source, ContextNotInitializedError):
            return _unavailable(str(error))
        return _unavailable("not running in a marimo kernel")

    graph = getattr(context, "graph", None)
    if graph is None:
        return _unavailable("marimo runtime has no dataflow graph")

    with _graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return _unavailable("marimo dataflow graph has no cells")
        cell_items = tuple(raw_cells.items())
        cell_ids = [str(cell_id) for cell_id, _cell in cell_items]
        cell_order = {cell_id: index for index, cell_id in enumerate(cell_ids)}
        parents = _parents(graph, cell_ids, cell_order)
        requested_output_ids = _unique_existing_ids(
            cell_ids if output_cell_ids is None else output_cell_ids,
            available_ids=set(cell_ids),
        )
        priority = _upstream_priority(requested_output_ids, parents)
        retained_ids = priority[:MAX_RELEVANT_CELLS]
        retained_id_set = set(retained_ids)
        omitted_ids = priority[MAX_RELEVANT_CELLS:]
        cells = tuple(
            _runtime_cell(
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
    namespace, namespace_complete = _runtime_globals(context)
    (
        controls,
        control_truncated_output_ids,
        control_incomplete_output_ids,
    ) = _collect_controls(
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
        from marimo._runtime.context import get_context
    except ImportError:
        return "unavailable"

    try:
        context = _read_runtime_context(get_context)
    except _RuntimeReadError:
        return "unavailable"

    graph = getattr(context, "graph", None)
    if graph is None:
        return "unavailable"
    with _graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return "unavailable"
        return "available" if cell_id in raw_cells else "missing"


def _runtime_cell(
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
        value = _read_runtime_attribute(cell, name)
    except _RuntimeReadError:
        return None
    return str(value) if value is not None else None


def _runtime_stale(cell: Any) -> bool | None:
    # Runtime cells are host-owned and may expose descriptors that raise.
    try:
        value = _read_runtime_attribute(cell, "stale")
    except _RuntimeReadError:
        return None
    return value if isinstance(value, bool) else None


def _definitions(cells: Sequence[RuntimeCell]) -> dict[str, tuple[str, ...]]:
    result: dict[str, list[str]] = {}
    for cell in cells:
        for name in cell.defs:
            result.setdefault(name, []).append(cell.id)
    return {name: tuple(cell_ids) for name, cell_ids in result.items()}


def _parents(
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


def _runtime_globals(context: Any) -> tuple[Mapping[str, Any], bool]:
    # The private runtime context may expose globals through a failing descriptor.
    try:
        value = _read_runtime_attribute(context, "globals")
    except _RuntimeReadError:
        return {}, False
    if not isinstance(value, Mapping):
        return {}, False
    return value, True


def _collect_controls(
    namespace: Mapping[str, Any],
    definitions: Mapping[str, tuple[str, ...]],
    *,
    cells: Sequence[RuntimeCell],
    output_cell_ids: Sequence[str],
) -> tuple[
    tuple[_control_state.RuntimeControl, ...],
    frozenset[str],
    frozenset[str],
]:
    cells_by_id = {cell.id: cell for cell in cells}
    defined_names_by_cell: dict[str, list[str]] = {
        cell_id: [] for cell_id in cells_by_id
    }
    for name, defining_cell_ids in definitions.items():
        for cell_id in defining_cell_ids:
            if cell_id in defined_names_by_cell:
                defined_names_by_cell[cell_id].append(name)
    for names in defined_names_by_cell.values():
        names.sort()

    cached: dict[
        str,
        tuple[_marimo_control_state.ControlSource | None, bool],
    ] = {}
    selected: dict[str, _marimo_control_state.ControlSource] = {}
    truncated_outputs: set[str] = set()
    incomplete_outputs: set[str] = set()
    for output_cell_id in output_cell_ids:
        ranked_names = _ranked_control_names(
            output_cell_id,
            cells_by_id,
            defined_names_by_cell,
        )
        retained_for_output = 0
        for name in ranked_names:
            if name not in cached:
                cached[name] = _lookup_control_source(
                    namespace,
                    definitions,
                    name,
                )
            source, complete = cached[name]
            if not complete:
                incomplete_outputs.add(output_cell_id)
            if source is None:
                continue
            if retained_for_output == _control_state.MAX_CONTROLS:
                truncated_outputs.add(output_cell_id)
                break
            retained_for_output += 1
            selected.setdefault(name, source)

    return (
        tuple(
            _marimo_control_state.capture_control(source)
            for source in selected.values()
        ),
        frozenset(truncated_outputs),
        frozenset(incomplete_outputs),
    )


def _ranked_control_names(
    output_cell_id: str,
    cells_by_id: Mapping[str, RuntimeCell],
    defined_names_by_cell: Mapping[str, Sequence[str]],
) -> tuple[str, ...]:
    output = cells_by_id.get(output_cell_id)
    if output is None:
        return ()
    names: list[str] = []
    seen_cells: set[str] = set()
    queue = deque([output_cell_id])

    for name in defined_names_by_cell.get(output_cell_id, ()):
        if not name.startswith("_") and name not in names:
            names.append(name)
    while queue:
        cell_id = queue.popleft()
        if cell_id in seen_cells:
            continue
        seen_cells.add(cell_id)
        cell = cells_by_id.get(cell_id)
        if cell is None:
            continue
        for name in cell.refs:
            if not name.startswith("_") and name not in names:
                names.append(name)
        queue.extend(
            parent_id
            for parent_id in cell.upstream_cell_ids
            if parent_id in cells_by_id and parent_id not in seen_cells
        )
    return tuple(names)


def _lookup_control_source(
    namespace: Mapping[str, Any],
    definitions: Mapping[str, tuple[str, ...]],
    name: str,
) -> tuple[_marimo_control_state.ControlSource | None, bool]:
    try:
        value = _read_namespace_value(namespace, name)
    except KeyError:
        return None, True
    except _RuntimeReadError:
        return None, False

    return (
        _marimo_control_state.identify_control(
            name=name,
            definition_cell_ids=definitions.get(name, ()),
            value=value,
        ),
        True,
    )


def _read_runtime_context(get_context: Callable[[], Any]) -> Any:
    try:
        return get_context()
    except Exception as error:
        raise _RuntimeReadError(error) from error


def _read_runtime_attribute(value: Any, name: str) -> Any:
    try:
        return getattr(value, name, None)
    except Exception as error:
        raise _RuntimeReadError(error) from error


def _read_namespace_value(namespace: Mapping[str, Any], name: str) -> Any:
    try:
        return namespace[name]
    except KeyError:
        raise
    except Exception as error:
        raise _RuntimeReadError(error) from error


def _graph_lock(value: Any) -> AbstractContextManager[Any]:
    if hasattr(value, "__enter__") and hasattr(value, "__exit__"):
        return cast(AbstractContextManager[Any], value)
    return nullcontext()


def _unavailable(reason: str) -> RuntimeSnapshot:
    return RuntimeSnapshot(
        available=False,
        filename="",
        reason=reason,
        available_cell_ids=frozenset(),
        cells=(),
        controls=(),
    )


__all__ = [
    "MarimoRuntimeAdapter",
    "collect_runtime_snapshot",
    "runtime_cell_status",
]
