"""Inspector for table-like non-dataframe objects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._capabilities import capabilities, selection_policy
from ._core import LensEntity
from ._metadata import columns, shape


class TableInspector:
    id = "table"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        if "table" not in type(value).__qualname__.lower():
            return None
        value_columns = columns(value)
        return {
            "kind": "table",
            "family": "tabular",
            "shape": shape(value),
            "columns": value_columns,
            "capabilities": capabilities(columnar_dom=bool(value_columns)),
            "selectionPolicy": selection_policy(
                "columnar-dom" if value_columns else "",
            ),
            "summary": f"{entity.name}: {type(value).__name__}",
        }
