"""Package version lookup."""

from __future__ import annotations

import importlib.metadata

try:
    __version__ = importlib.metadata.version("marimo-lens")
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"

__all__ = ["__version__"]
