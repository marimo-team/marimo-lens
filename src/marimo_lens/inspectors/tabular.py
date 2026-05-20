"""Inspector for dataframe-like tabular objects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._capabilities import capabilities, selection_policy
from ._core import LensEntity
from ._metadata import columns, is_dataframe_like, shape, tabular_summary


class TabularInspector:
    id = "tabular"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        value_columns = columns(value)
        value_shape = shape(value)
        if not is_dataframe_like(value, value_columns, value_shape):
            return None
        return {
            "kind": "dataframe",
            "family": "tabular",
            "shape": value_shape,
            "columns": value_columns,
            "capabilities": capabilities(columnar_dom=True),
            "selectionPolicy": selection_policy("columnar-dom"),
            "summary": tabular_summary(entity.name, value, value_shape),
        }
