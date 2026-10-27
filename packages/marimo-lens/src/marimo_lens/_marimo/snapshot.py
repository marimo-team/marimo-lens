"""Snapshot the notebook's cells and dataflow graph from the running marimo kernel."""

from __future__ import annotations

import threading
import weakref
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from .._notebook.snapshot import (
    MAX_NOTEBOOK_CELLS,
    MAX_REPORTED_OMITTED_CELL_IDS,
    RuntimeCell,
    RuntimeCellStatus,
    RuntimeSnapshot,
    cell_name,
    upstream_order,
)
from .controls import collect_controls
from .kernel import (
    RuntimeReadError,
    graph_lock,
    notebook_filename,
    read_runtime_attribute,
    read_runtime_context,
    runtime_context,
    runtime_globals,
)


def collect_runtime_snapshot(
    output_cell_ids: Sequence[str],
    *,
    controls: bool = True,
) -> RuntimeSnapshot:
    """Read the notebook's cells, lineage, and relevant controls.

    The snapshot keeps up to ``MAX_NOTEBOOK_CELLS`` cells: the requested output
    cells and their upstream closure first, then the remaining cells in
    notebook order. Controls are read only for the requested output cells.
    """

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

    live_document = _document_cells()
    with graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return _unavailable("marimo dataflow graph has no cells")
        document_cells, document, unseen = _notebook_document(
            getattr(context, "ui_element_registry", None),
            live_document,
            frozenset(str(cell_id) for cell_id in raw_cells),
        )
        names = {cell.id: cell.name for cell in document_cells if cell.name is not None}
        document_order = {cell.id: index for index, cell in enumerate(document_cells)}
        cell_items = sorted(
            ((str(cell_id), cell) for cell_id, cell in tuple(raw_cells.items())),
            key=lambda item: document_order.get(item[0], len(document_order)),
        )
        cell_ids = [cell_id for cell_id, _cell in cell_items]
        cell_order = {cell_id: index for index, cell_id in enumerate(cell_ids)}
        parents = graph_parents(graph, cell_ids, cell_order)
        requested_output_ids = _unique_existing_ids(
            output_cell_ids,
            available_ids=set(cell_ids),
        )
        # Requested cells that marimo did not register stay ahead of the bound.
        requested = set(output_cell_ids)
        unregistered_cells = sorted(
            (cell for cell in document_cells if cell.id not in raw_cells),
            key=lambda cell: cell.id not in requested,
        )
        graph_room = MAX_NOTEBOOK_CELLS - sum(
            cell.id in requested for cell in unregistered_cells
        )
        closure = upstream_order(requested_output_ids, parents)
        closure_ids = set(closure)
        priority = [*closure, *(i for i in cell_ids if i not in closure_ids)]
        retained_id_set = set(priority[:graph_room])
        omitted_ids = priority[graph_room:]
        known = _known_names(getattr(context, "ui_element_registry", None))
        cells = tuple(
            runtime_cell(
                cell_id,
                cell,
                name=names.get(cell_id),
                upstream_cell_ids=parents.get(cell_id, ()),
                known=known,
            )
            for cell_id, cell in cell_items
            if cell_id in retained_id_set
        )
        if len(known) > len(raw_cells):
            for cell_id in known.keys() - set(cell_ids):
                del known[cell_id]
        # Other unregistered cells share the notebook bound after graph cells.
        room = max(0, MAX_NOTEBOOK_CELLS - len(cells))
        # The kernel holds no run of a cell it never registered, so code mode
        # reports such a cell as stale whenever it has code.
        unregistered = tuple(
            replace(cell, stale=bool(cell.code)) for cell in unregistered_cells[:room]
        )
        omitted_ids = [*omitted_ids, *(cell.id for cell in unregistered_cells[room:])]
        omitted_id_set = set(omitted_ids)
        cell_truncated_output_ids = frozenset(
            output_id
            for output_id in requested_output_ids
            if _closure_intersects(output_id, parents, omitted_id_set)
        )
    namespace, namespace_complete = runtime_globals(context)
    retained_output_ids = tuple(
        output_id for output_id in requested_output_ids if output_id in retained_id_set
    )
    if controls:
        (
            runtime_controls,
            control_truncated_output_ids,
            control_incomplete_output_ids,
        ) = collect_controls(
            namespace,
            _definitions(cells),
            cells=cells,
            output_cell_ids=retained_output_ids,
        )
    else:
        runtime_controls, control_truncated_output_ids = (), frozenset()
        control_incomplete_output_ids = frozenset()
    return RuntimeSnapshot(
        available=True,
        filename=notebook_filename(context, namespace),
        reason="",
        available_cell_ids=frozenset(requested_output_ids),
        cells=cells,
        unregistered=unregistered,
        document=document,
        unseen=unseen,
        controls=runtime_controls,
        omitted_cell_ids=tuple(omitted_ids[:MAX_REPORTED_OMITTED_CELL_IDS]),
        omitted_cell_count=len(omitted_ids),
        cell_truncated_output_ids=cell_truncated_output_ids,
        control_truncated_output_ids=control_truncated_output_ids,
        control_incomplete_output_ids=(
            control_incomplete_output_ids
            if namespace_complete or not controls
            else frozenset(retained_output_ids)
        ),
    )


@dataclass(slots=True)
class _Document:
    """The latest notebook document Lens read in one kernel.

    ``cells`` keeps that document's order and names, without code. ``seen``
    holds every cell ID of that document and every cell the kernel registered
    since.
    """

    cells: tuple[RuntimeCell, ...]
    seen: set[str]


_DOCUMENTS: weakref.WeakKeyDictionary[object, _Document] = weakref.WeakKeyDictionary()

_SCOPE_STATE_LOCK = threading.Lock()


def _notebook_document(
    scope: object | None,
    live: tuple[RuntimeCell, ...] | None,
    registered: frozenset[str],
) -> tuple[tuple[RuntimeCell, ...], bool, frozenset[str]]:
    """Return the document's cells, whether Lens knows them all, and the unseen ones.

    marimo hands the kernel its document only during a code-mode call, so
    Lens keeps the latest one per kernel. Outside code mode, the graph shows
    only the cells the kernel registered. A cell that document held, or that
    the kernel registered since, and that the graph lacks now is unseen: it
    may be deleted, or its code may not parse. A cell neither that document
    nor the graph since held stays deleted.
    """

    if scope is None:
        return live or (), live is not None, frozenset()
    with _SCOPE_STATE_LOCK:
        if live is not None:
            _DOCUMENTS[scope] = _Document(
                cells=tuple(replace(cell, code="") for cell in live),
                seen={cell.id for cell in live} | registered,
            )
            return live, True, frozenset()
        memory = _DOCUMENTS.get(scope)
        if memory is None:
            return (), False, frozenset()
        memory.seen |= registered
        cells = tuple(cell for cell in memory.cells if cell.id in registered)
        return cells, True, frozenset(memory.seen - registered)


def _document_cells() -> tuple[RuntimeCell, ...] | None:
    """Return the cells of marimo's notebook document in notebook order.

    marimo hands the kernel a copy of its notebook document only while a
    code-mode call runs. Other kernel work sees no document and gets None.
    """

    try:
        from marimo._messaging.notebook.document import get_current_document
    except ImportError:
        return None
    try:
        document = read_runtime_context(get_current_document)
        if document is None:
            return None
        raw_cells = read_runtime_attribute(document, "cells")
    except RuntimeReadError:
        return None
    if not isinstance(raw_cells, Sequence):
        return None
    cells: list[RuntimeCell] = []
    for document_cell in raw_cells:
        cell_id = getattr(document_cell, "id", None)
        code = getattr(document_cell, "code", None)
        if not isinstance(cell_id, str) or not isinstance(code, str):
            continue
        cells.append(
            RuntimeCell(
                id=cell_id,
                code=code,
                defs=(),
                refs=(),
                upstream_cell_ids=(),
                language="python",
                name=cell_name(getattr(document_cell, "name", None)),
            )
        )
    return tuple(cells)


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


_KnownNames = dict[str, tuple[object, tuple[str, ...], tuple[str, ...]]]

_KNOWN_NAMES: weakref.WeakKeyDictionary[object, _KnownNames] = (
    weakref.WeakKeyDictionary()
)


def _known_names(scope: object | None) -> _KnownNames:
    """Return one kernel's sorted defs and refs, kept per compiled cell."""

    if scope is None:
        return {}
    with _SCOPE_STATE_LOCK:
        return _KNOWN_NAMES.setdefault(scope, {})


def runtime_cell(
    cell_id: str,
    cell: Any,
    *,
    name: str | None,
    upstream_cell_ids: tuple[str, ...],
    known: _KnownNames | None = None,
) -> RuntimeCell:
    code = str(getattr(cell, "code", "") or "")
    # marimo compiles new code into a new cell object, so one object keeps
    # its names. Sorting them for every cell dominated a large snapshot.
    entry = known.get(cell_id) if known is not None else None
    if entry is not None and entry[0] is cell:
        defs, refs = entry[1], entry[2]
    else:
        defs = tuple(sorted(str(name) for name in getattr(cell, "defs", ()) or ()))
        refs = tuple(sorted(str(name) for name in getattr(cell, "refs", ()) or ()))
        if known is not None:
            known[cell_id] = (cell, defs, refs)
    return RuntimeCell(
        id=cell_id,
        name=name,
        code=code,
        defs=defs,
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
    return {
        cell_id: tuple(
            sorted(
                (str(parent) for parent in graph.parents.get(cell_id, ())),
                key=lambda parent: (cell_order.get(parent, fallback_order), parent),
            )
        )
        for cell_id in cell_ids
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
