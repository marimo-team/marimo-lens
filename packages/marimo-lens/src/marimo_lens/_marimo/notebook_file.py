"""Read a notebook file that no kernel runs."""

from __future__ import annotations

import pathlib
from collections.abc import Sequence
from typing import TYPE_CHECKING

from .._notebook.snapshot import (
    RuntimeCell,
    RuntimeCellStatus,
    RuntimeSnapshot,
    cell_name,
)
from .snapshot import graph_parents, runtime_cell

if TYPE_CHECKING:
    from marimo._ast.app import InternalApp


def notebook_file_snapshot(notebook: pathlib.Path) -> RuntimeSnapshot:
    """Read a notebook file's cells as a new kernel would load them.

    Raises:
        ValueError: marimo cannot load the file as a notebook.
    """

    return _snapshot(_load(notebook), notebook)


class NotebookFile:
    """Serve a Lens session's notebook reads from a notebook file.

    Every read sees the cells of one load, as a kernel started on the file
    holds them.
    """

    __slots__ = ("_app", "contents")

    def __init__(self, notebook: pathlib.Path) -> None:
        """Load ``notebook``.

        Raises:
            ValueError: marimo cannot load the file as a notebook.
        """

        self._app = _load(notebook)
        self.contents = _snapshot(self._app, notebook)

    def snapshot(self, output_cell_ids: Sequence[str]) -> RuntimeSnapshot:
        return self.contents

    def notebook(self, cell_ids: Sequence[str] = ()) -> RuntimeSnapshot:
        return self.contents

    def cell_status(self, cell_id: str) -> RuntimeCellStatus:
        return "available" if cell_id in self.contents.available_cell_ids else "missing"


def _load(notebook: pathlib.Path) -> InternalApp:
    """Load a notebook as marimo's editor does, refusing what it would open blank.

    ``load_app`` assigns cell IDs by position, the IDs a kernel started on
    the file uses. It returns None for an empty or invalid file.
    """

    from marimo._ast.app import InternalApp
    from marimo._ast.load import load_app

    try:
        app = load_app(str(notebook))
    except Exception as error:
        raise ValueError(f"marimo cannot load {notebook}: {error}") from error
    if app is None:
        raise ValueError(f"marimo cannot load {notebook}: it holds no notebook.")
    return InternalApp(app)


def _snapshot(app: InternalApp, notebook: pathlib.Path) -> RuntimeSnapshot:
    """Snapshot the cells of a loaded notebook, with no runtime state.

    A kernel registers each cell whose code parses, and keeps the rest in the
    notebook document as stale cells it never ran. ``InternalApp.graph``
    refuses a notebook with such a cell, so the graph is built here.
    """

    from marimo._runtime.dataflow import DirectedGraph

    graph = DirectedGraph()
    for cell_id, cell in app.cell_manager.valid_cells():
        graph.register_cell(cell_id, cell._cell)
    data = list(app.cell_manager.cell_data())
    names = {
        str(cell.cell_id): name
        for cell in data
        if (name := cell_name(cell.name)) is not None
    }
    registered = [cell for cell in data if cell.cell_id in graph.cells]
    cell_ids = [str(cell.cell_id) for cell in registered]
    order = {cell_id: index for index, cell_id in enumerate(cell_ids)}
    parents = graph_parents(graph, cell_ids, order)
    cells = tuple(
        runtime_cell(
            str(cell.cell_id),
            graph.cells[cell.cell_id],
            name=names.get(str(cell.cell_id)),
            upstream_cell_ids=parents.get(str(cell.cell_id), ()),
        )
        for cell in registered
    )
    unregistered = tuple(
        RuntimeCell(
            id=str(cell.cell_id),
            code=cell.code,
            defs=(),
            refs=(),
            upstream_cell_ids=(),
            language="python",
            name=names.get(str(cell.cell_id)),
            stale=bool(cell.code),
        )
        for cell in data
        if cell.cell_id not in graph.cells
    )
    return RuntimeSnapshot(
        available=True,
        filename=str(notebook),
        reason="",
        available_cell_ids=frozenset(cell_ids),
        cells=cells,
        controls=(),
        unregistered=unregistered,
        document=True,
    )
