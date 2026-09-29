"""Decide which Lens a marimo notebook shows."""

from __future__ import annotations

import ast

from ._marimo_runtime import (
    current_cell_id,
    current_runtime_scope,
    edit_session,
    notebook_cell_codes,
    runtime_cell_status,
)
from ._registry import mark_automatic, open_lenses
from .widget import Lens


def notebook_lens() -> Lens | None:
    """Return the oldest open Lens in the active marimo runtime.

    Hosts call this to show the notebook's Lens in another browser document,
    such as a preview. Returns None outside a marimo runtime or when the
    runtime holds no open Lens.
    """

    lenses = open_lenses(current_runtime_scope())
    return lenses[0] if lenses else None


def automatic_lens() -> Lens | None:
    """Return a new Lens for marimo to show, or None when the notebook needs none.

    marimo calls this after a notebook cell that imports marimo runs in its
    editor and shows the returned Lens in that cell's output. Returns None
    outside the editor or a notebook cell, while the runtime holds an open
    Lens, and when a notebook cell creates its own Lens. A Lens that a notebook
    cell creates later closes the automatic Lens.
    """

    cell_id = current_cell_id()
    if (
        not edit_session()
        or cell_id is None
        or runtime_cell_status(cell_id) != "available"
        or notebook_lens() is not None
        or any(_creates_lens(code) for code in notebook_cell_codes())
    ):
        return None
    lens = Lens()
    mark_automatic(lens)
    return lens


# Recognizing these cells before they run keeps marimo from rendering an
# automatic Lens that the notebook's own Lens would close moments later, while
# the automatic Lens's browser view is still initializing.
def _creates_lens(code: str) -> bool:
    if "marimo_lens" not in code or "Lens" not in code:
        return False
    try:
        nodes = tuple(ast.walk(ast.parse(code)))
    except SyntaxError:
        return False
    imports_module = any(
        isinstance(node, ast.Import)
        and any(alias.name == "marimo_lens" for alias in node.names)
        for node in nodes
    )
    return any(
        (
            isinstance(node, ast.ImportFrom)
            and node.level == 0
            and (node.module or "").partition(".")[0] == "marimo_lens"
            and any(alias.name in {"Lens", "*"} for alias in node.names)
        )
        or (imports_module and isinstance(node, ast.Attribute) and node.attr == "Lens")
        for node in nodes
    )


__all__ = ["automatic_lens", "notebook_lens"]
