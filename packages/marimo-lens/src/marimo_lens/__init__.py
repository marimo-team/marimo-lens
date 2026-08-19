"""Public marimo-lens API."""

from __future__ import annotations

from importlib import metadata

from . import agent as agent
from .context import (
    CellReference,
    LensContext,
    LensReferences,
    NotebookReference,
    SelectionReference,
    SelectionTargetReference,
)
from .errors import LensError
from .widget import Lens

__version__ = metadata.version("marimo-lens")

__all__ = [
    "CellReference",
    "Lens",
    "LensContext",
    "LensError",
    "LensReferences",
    "NotebookReference",
    "SelectionReference",
    "SelectionTargetReference",
    "__version__",
]
