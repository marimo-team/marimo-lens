"""Inspector for table-like non-dataframe objects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._core import LensEntity
from ._metadata import columns, inspected_target, schema_columns_and_dtypes, shape


class TableInspector:
    id = "table"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        value_columns = columns(value)
        value_shape = shape(value)
        if not _is_table_like(value, value_columns, value_shape):
            return None
        return inspected_target(
            kind="table",
            family="tabular",
            shape=value_shape,
            columns=value_columns,
            capability_flags={"columnar_dom": bool(value_columns)},
            surfaces=("columnar-dom" if value_columns else "",),
            summary=f"{entity.name}: {type(value).__name__}",
        )


def _is_table_like(
    value: Any,
    value_columns: list[dict[str, Any]],
    value_shape: Mapping[str, int] | None,
) -> bool:
    schema_columns, _dtypes = schema_columns_and_dtypes(getattr(value, "schema", None))
    if not schema_columns:
        return False
    if not value_columns:
        return False
    if value_shape is not None:
        return True
    if isinstance(getattr(value, "row_count", None), int):
        return True
    if isinstance(getattr(value, "num_rows", None), int):
        return True
    if isinstance(getattr(value, "rows", None), (list, tuple)):
        return True
    return False
