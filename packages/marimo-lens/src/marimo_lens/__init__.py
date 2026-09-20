"""Public marimo-lens API."""

from __future__ import annotations

from importlib import metadata

from . import agent as agent
from .activity import ActivityHandle
from .context import (
    CellReference,
    LensContext,
    LensReferences,
    NotebookReference,
    SelectionReference,
    SelectionTargetReference,
)
from .errors import LensError
from .reveal import RevealStep
from .widget import Lens

__version__ = metadata.version("marimo-lens")

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
]
