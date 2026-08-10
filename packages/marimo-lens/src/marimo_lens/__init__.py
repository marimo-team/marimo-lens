"""Public marimo-lens API."""

from __future__ import annotations

from importlib import metadata

from . import agent as agent
from .context import (
    LensContext,
    LensReferences,
    NotebookReference,
    SelectionReference,
)
from .errors import LensError
from .widget import Lens

__version__ = metadata.version("marimo-lens")

__all__ = [
    "Lens",
    "LensContext",
    "LensError",
    "LensReferences",
    "NotebookReference",
    "SelectionReference",
    "__version__",
]
