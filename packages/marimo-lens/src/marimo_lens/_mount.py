"""Decide which Lens a marimo notebook shows."""

from __future__ import annotations

import ast
from collections.abc import Sequence

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
    editor and displays the returned Lens, which belongs to that cell. Returns
    None outside the editor or a notebook cell, while the runtime holds an open
    Lens, and when a notebook cell creates its own Lens. A Lens that a notebook
    cell creates later closes the automatic Lens.
    """

    cell_id = current_cell_id()
    if (
        not edit_session()
        or cell_id is None
        or runtime_cell_status(cell_id) != "available"
        or notebook_lens() is not None
        or _constructs_lens(notebook_cell_codes())
    ):
        return None
    lens = Lens()
    mark_automatic(lens)
    return lens


# Recognizing these cells before they run keeps marimo from rendering an
# automatic Lens that the notebook's own Lens would close moments later, while
# the automatic Lens's browser view is still initializing.
def _constructs_lens(codes: Sequence[str]) -> bool:
    if not any("marimo_lens" in code for code in codes):
        return False
    trees = []
    for code in codes:
        try:
            trees.append(ast.parse(code))
        except SyntaxError:
            continue
    cells = [(tree, _lens_names(tree)) for tree in trees]
    # marimo shares public names across cells and keeps `_` names cell-local.
    shared = {
        (kind, name)
        for _tree, names in cells
        for kind, name in names
        if not name.startswith("_")
    }
    return any(_calls_lens(tree, shared | names) for tree, names in cells)


def _lens_names(tree: ast.AST) -> set[tuple[str, str]]:
    """Return ("class", name) and ("module", name) bindings to marimo-lens."""

    names: set[tuple[str, str]] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0:
            if (node.module or "").partition(".")[0] == "marimo_lens":
                names.update(
                    ("class", alias.asname or "Lens")
                    for alias in node.names
                    if alias.name in {"Lens", "*"}
                )
        elif isinstance(node, ast.Import):
            names.update(
                ("module", alias.asname or alias.name.partition(".")[0])
                for alias in node.names
                if alias.name.partition(".")[0] == "marimo_lens"
            )
    return names


def _calls_lens(tree: ast.AST, names: set[tuple[str, str]]) -> bool:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and ("class", func.id) in names:
            return True
        if isinstance(func, ast.Attribute) and func.attr == "Lens":
            receiver = func.value
            while isinstance(receiver, ast.Attribute):
                receiver = receiver.value
            if isinstance(receiver, ast.Name) and ("module", receiver.id) in names:
                return True
    return False


__all__ = ["automatic_lens", "notebook_lens"]
