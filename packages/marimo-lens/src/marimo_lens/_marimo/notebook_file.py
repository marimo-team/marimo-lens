"""Snapshot a notebook file that no kernel runs."""

from __future__ import annotations

import pathlib

from .._notebook.snapshot import RuntimeCell, RuntimeSnapshot, cell_name
from .snapshot import graph_parents, runtime_cell


def notebook_file_snapshot(notebook: pathlib.Path) -> RuntimeSnapshot:
    """Read a notebook file's cells as a new kernel would load them.

    Nothing runs, so cells carry no runtime state. marimo assigns cell IDs by
    position on load, the same IDs a kernel started on the file would use.
    Cells whose code does not parse stay outside the graph, as in a kernel.

    Raises:
        ValueError: marimo cannot load the file as a notebook.
    """

    from marimo._ast.app import InternalApp
    from marimo._ast.load import load_app

    try:
        app = load_app(str(notebook))
    except Exception as error:
        raise ValueError(f"marimo cannot load {notebook}: {error}") from error
    if app is None:
        raise ValueError(f"marimo cannot load {notebook}: it holds no notebook.")
    internal = InternalApp(app)
    graph = internal.graph
    data = list(internal.cell_manager.cell_data())
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
