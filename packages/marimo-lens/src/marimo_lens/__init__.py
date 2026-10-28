"""Public marimo-lens API."""

from __future__ import annotations

from importlib import metadata

from . import agent as agent
from ._context.lens_context import LensContext
from ._core.errors import LensError
from ._core.record import Record, RecordOptions
from ._core.types import (
    ActivityHandle,
    CellReference,
    ChatRequestReference,
    Diagnostic,
    LensReferences,
    NotebookReference,
    RecordedChange,
    RecordedImage,
    RecordedRequest,
    RequestReference,
    RevealStep,
    SelectionReference,
    SelectionTargetReference,
)
from ._file_context import ChatRequest, Selection, notebook_context, record_request
from ._widget.lens import Lens
from ._widget.mount import automatic_lens, notebook_lens

__version__ = metadata.version("marimo-lens")

# Code-mode tracebacks name the error by its module, and agents match on
# `marimo_lens.LensError`.
LensError.__module__ = __name__

__all__ = [
    "ActivityHandle",
    "CellReference",
    "ChatRequest",
    "ChatRequestReference",
    "Diagnostic",
    "Lens",
    "LensContext",
    "LensError",
    "LensReferences",
    "NotebookReference",
    "Record",
    "RecordOptions",
    "RecordedChange",
    "RecordedImage",
    "RecordedRequest",
    "RequestReference",
    "RevealStep",
    "Selection",
    "SelectionReference",
    "SelectionTargetReference",
    "__version__",
    "agent",
    "automatic_lens",
    "notebook_context",
    "notebook_lens",
    "record_request",
]
