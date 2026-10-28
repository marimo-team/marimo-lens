"""A notebook file and the kernel marimo starts on it."""

from __future__ import annotations

import pathlib
import textwrap

import pytest

from tests.support.kernel import FakeNotebook

SALES = textwrap.dedent(
    """
    import marimo

    app = marimo.App()


    @app.cell
    def data():
        sales = load()
        return (sales,)


    @app.cell
    def net(sales):
        net = sales[sales.amount > 0]
        return (net,)


    @app.cell
    def revenue_chart(net):
        chart(net)
        return
    """
)
"""Three named cells: data feeds a filter that feeds a chart."""


def kernel_cells(path: pathlib.Path) -> dict[str, tuple[str, str]]:
    """Each cell's ID and code by name, as marimo's editor loads the file."""

    from marimo._session.notebook import load_notebook

    return {
        cell.name: (str(cell.cell_id), cell.code)
        for cell in load_notebook(path).app.cell_manager.cell_data()
    }


def start_kernel(monkeypatch: pytest.MonkeyPatch, path: pathlib.Path) -> FakeNotebook:
    """A kernel started on ``path``, with the cell IDs and names marimo gives it."""

    cells = kernel_cells(path)
    notebook = FakeNotebook(
        monkeypatch, path, {cell_id: code for cell_id, code in cells.values()}
    )
    notebook.names = {cell_id: name for name, (cell_id, _code) in cells.items()}
    return notebook
