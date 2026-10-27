"""Public marimo-lens API."""

from __future__ import annotations

from importlib import metadata

from . import agent as agent
from ._context.lens_context import LensContext
from ._core.errors import LensError
from ._core.types import (
    ActivityHandle,
    CellReference,
    LensReferences,
    NotebookReference,
    RevealStep,
    SelectionReference,
    SelectionTargetReference,
)
from ._widget.lens import Lens
from ._widget.mount import automatic_lens, notebook_lens

__version__ = metadata.version("marimo-lens")

# Code-mode tracebacks name the error by its module, and agents match on
# `marimo_lens.LensError`.
LensError.__module__ = __name__

__all__ = [
    "ActivityHandle",
    "CellReference",
    "Lens",
    "LensContext",
    "LensError",
    "LensReferences",
    "NotebookReference",
    "RevealStep",
    "SelectionReference",
    "SelectionTargetReference",
    "__version__",
    "agent",
    "automatic_lens",
    "notebook_lens",
]
