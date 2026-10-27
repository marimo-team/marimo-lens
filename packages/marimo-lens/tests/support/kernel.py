"""A notebook kernel that Lens reads through marimo's runtime context."""

from __future__ import annotations

import ast
import contextlib
import pathlib
from collections.abc import Generator, Sequence
from types import SimpleNamespace
from typing import Any

import pytest

SALES = {
    "cell-data": "sales = load()",
    "cell-net": "net = sales[sales.amount > 0]",
    "cell-chart": "chart(net)",
}
"""A three-cell notebook: data feeds a filter that feeds a chart."""


class FakeNotebook:
    """Cells in a marimo dataflow graph, edited the way an agent or analyst would.

    Each cell's definitions and references come from its code, and each cell's
    parents are the cells that define the names it references. As in marimo, a
    cell whose code does not parse leaves the graph and stays in the notebook
    document, which the kernel sees only during a code-mode call.
    """

    def __init__(
        self,
        monkeypatch: pytest.MonkeyPatch,
        filename: pathlib.Path | None,
        cells: dict[str, str] | None = None,
        *,
        mode: str = "edit",
    ) -> None:
        self.cells: dict[str, SimpleNamespace] = {}
        self.unregistered: dict[str, str] = {}
        self.names: dict[str, str] = {}
        self.statuses: dict[str, tuple[str | None, str | None, bool | None]] = {}
        self.scope = _Scope()
        self.filename = filename
        for cell_id, code in (cells or {}).items():
            self.set(cell_id, code)
        self.context = SimpleNamespace(
            graph=SimpleNamespace(cells=self.cells, parents={}, definitions={}),
            globals={} if filename is None else {"__file__": str(filename)},
            filename=None if filename is None else str(filename),
            ui_element_registry=self.scope,
            execution_context=None,
            cell_lifecycle_registry=_LifecycleRegistry(),
        )
        self._refresh()

        import marimo._runtime.app_meta as app_meta_module
        import marimo._runtime.context as context_module

        monkeypatch.setattr(context_module, "get_context", lambda: self.context)
        monkeypatch.setattr(app_meta_module, "get_mode", lambda: mode)

    def set(self, cell_id: str, code: str) -> None:
        try:
            ast.parse(code)
        except SyntaxError:
            self.cells.pop(cell_id, None)
            self.unregistered[cell_id] = code
            if hasattr(self, "context"):
                self._refresh()
            return
        self.unregistered.pop(cell_id, None)
        defs, refs = _names(code)
        state, result, stale = self.statuses.get(cell_id, ("idle", "success", False))
        self.cells[cell_id] = SimpleNamespace(
            code=code,
            defs=defs,
            refs=refs,
            language="python",
            runtime_state=state,
            run_result_status=result,
            stale=stale,
        )
        if hasattr(self, "context"):
            self._refresh()

    def delete(self, cell_id: str) -> None:
        self.cells.pop(cell_id, None)
        self.unregistered.pop(cell_id, None)
        self._refresh()

    @contextlib.contextmanager
    def code_mode(self) -> Generator[None]:
        """Run the block as a code-mode call, with the notebook document in reach."""

        from marimo._ast.cell import CellConfig
        from marimo._messaging.notebook.document import (
            NotebookCell,
            NotebookDocument,
            notebook_document_context,
        )
        from marimo._types.ids import CellId_t

        codes = {cell_id: cell.code for cell_id, cell in self.cells.items()}
        document = NotebookDocument(
            [
                NotebookCell(
                    CellId_t(cell_id), code, self.names.get(cell_id, "_"), CellConfig()
                )
                for cell_id, code in {**codes, **self.unregistered}.items()
            ]
        )
        with notebook_document_context(document):
            yield

    def mark(
        self,
        cell_id: str,
        *,
        runtime_state: str | None = "idle",
        run_result_status: str | None = "success",
        stale: bool | None = False,
    ) -> None:
        self.statuses[cell_id] = (runtime_state, run_result_status, stale)
        self.set(cell_id, self.cells[cell_id].code)

    def code(self, cell_id: str) -> str:
        if cell_id in self.unregistered:
            return self.unregistered[cell_id]
        return str(self.cells[cell_id].code)

    def _refresh(self) -> None:
        definitions: dict[str, set[str]] = {}
        for cell_id, cell in self.cells.items():
            for name in cell.defs:
                definitions.setdefault(name, set()).add(cell_id)
        self.context.graph.definitions = definitions
        self.context.graph.parents = {
            cell_id: {
                parent
                for name in cell.refs
                for parent in definitions.get(name, set())
                if parent != cell_id
            }
            for cell_id, cell in self.cells.items()
        }


class _LifecycleRegistry:
    """Runs cell lifecycle items as marimo does outside a cell."""

    def __init__(self) -> None:
        self.registry: dict[str, set[Any]] = {}

    def add(self, item: Any) -> None:
        item.create(None)

    def inject(self, cell_id: str, item: Any) -> None:
        self.registry.setdefault(cell_id, set()).add(item)


class _Scope:
    """Stands in for marimo's UI element registry, which identifies a runtime."""


def _names(code: str) -> tuple[set[str], set[str]]:
    """Approximate marimo's definitions and references for test cells."""

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return set(), set()
    defs: set[str] = set()
    loads: set[str] = set()
    for node in tree.body:
        for target in _bound(node):
            defs.add(target)
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            loads.add(node.id)
    return defs, loads - defs


def _bound(node: ast.stmt) -> Sequence[str]:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return [(alias.asname or alias.name).partition(".")[0] for alias in node.names]
    targets: list[Any] = []
    if isinstance(node, ast.Assign):
        targets = node.targets
    elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
        targets = [node.target]
    return [
        name.id
        for target in targets
        for name in ast.walk(target)
        if isinstance(name, ast.Name)
    ]
