"""Fallback inspector for ordinary Python objects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._capabilities import capabilities
from ._core import LensEntity
from ._metadata import columns, shape


class ObjectInspector:
    id = "object"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value_columns = columns(entity.value)
        return {
            "kind": "object",
            "family": "object",
            "shape": shape(entity.value),
            "columns": value_columns,
            "capabilities": capabilities(columnar_dom=bool(value_columns)),
            "summary": f"{entity.name}: {type(entity.value).__name__}",
        }
