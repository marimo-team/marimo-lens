"""Read a notebook file that no kernel runs, with the results marimo kept."""

from __future__ import annotations

import dataclasses
import json
import pathlib
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from .._notebook.snapshot import (
    RuntimeCell,
    RuntimeCellStatus,
    RuntimeSnapshot,
    cell_name,
)
from .snapshot import graph_parents, runtime_cell

if TYPE_CHECKING:
    from marimo._ast.app import InternalApp
    from marimo._runtime.dataflow import DirectedGraph


class NotebookFile:
    """Serve a Lens session's notebook reads from a notebook file.

    Every read sees the cells of the last load, as a kernel started on the
    file holds them, with the state the last run marimo saved gives them.
    ``reload`` reads the file again the way marimo's editor follows an edit
    on disk. ``last_run`` False skips the saved run, for readers of code and
    graph alone.
    """

    __slots__ = ("_app", "_last_run", "contents")

    def __init__(self, notebook: pathlib.Path, *, last_run: bool = True) -> None:
        """Load ``notebook``.

        Raises:
            ValueError: marimo cannot load the file as a notebook.
        """

        self._last_run = last_run
        self._app = _load(notebook)
        self.contents = _snapshot(self._app, notebook, last_run=last_run)

    def reload(self, notebook: pathlib.Path) -> None:
        """Load ``notebook`` as the next version of the loaded one.

        A cell keeps its ID when marimo matches it to a loaded cell by its
        code, so an edited cell stays the same cell and a new one gets a new
        ID.

        Raises:
            ValueError: marimo cannot load the file as a notebook.
        """

        app = _load(notebook)
        app.cell_manager.sort_cell_ids_by_similarity(self._app.cell_manager)
        self._app = app
        self.contents = _snapshot(app, notebook, last_run=self._last_run)

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


def _snapshot(
    app: InternalApp, notebook: pathlib.Path, *, last_run: bool
) -> RuntimeSnapshot:
    """Snapshot the cells of a loaded notebook and the last run marimo saved.

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
    states = _states(graph, _saved_run(notebook) if last_run else None)
    cells = tuple(
        dataclasses.replace(
            runtime_cell(
                str(cell.cell_id),
                graph.cells[cell.cell_id],
                name=names.get(str(cell.cell_id)),
                upstream_cell_ids=parents.get(str(cell.cell_id), ()),
            ),
            **states.get(cell.cell_id, {}),
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


def _saved_run(notebook: pathlib.Path) -> Mapping[str, bool] | None:
    """Return whether each cell raised in the last run marimo saved, by its code.

    marimo keeps the outputs of the last run in ``__marimo__/session/`` beside
    the notebook, keyed by the ``code_hash`` of the code each cell ran. None
    means no saved run, or one ``marimo export session`` would run again
    because the notebook's code or script metadata changed since.
    """

    from marimo._export._session_cache import is_session_snapshot_stale
    from marimo._schemas.session import VERSION
    from marimo._session.state.serialize import get_session_cache_file
    from marimo._utils.marimo_path import MarimoPath

    saved = get_session_cache_file(notebook)
    try:
        if is_session_snapshot_stale(saved, MarimoPath(notebook)):
            return None
        session = json.loads(saved.read_text("utf-8"))
        if session["version"] != VERSION:
            return None
        return {
            cell["code_hash"]: any(
                output["type"] == "error" for output in cell["outputs"]
            )
            for cell in session["cells"]
            if cell["code_hash"]
        }
    except (OSError, ValueError, LookupError, TypeError):
        return None


def _states(
    graph: DirectedGraph, saved: Mapping[str, bool] | None
) -> dict[str, dict[str, Any]]:
    """Return the run state each registered cell's output has.

    A disabled cell reads as disabled, as a kernel reports it. A saved run
    that still matches the notebook gives every other cell the result its
    code had there.
    """

    from marimo._utils.code import hash_code

    states: dict[str, dict[str, Any]] = {
        cell_id: {"run_result_status": "disabled"}
        for cell_id in graph.cells
        if graph.is_disabled(cell_id)
    }
    if saved is None:
        return states
    for cell_id, cell in graph.cells.items():
        raised = saved.get(hash_code(cell.code)) if cell.code else None
        if raised is not None:
            states.setdefault(
                cell_id, {"run_result_status": "exception" if raised else "success"}
            )
    return states
