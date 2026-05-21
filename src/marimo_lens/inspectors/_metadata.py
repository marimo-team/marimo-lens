"""Shared metadata helpers for built-in inspectors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ._capabilities import capabilities as target_capabilities
from ._capabilities import selection_policy
from .._runtime_value_metadata import (
    control_summary,
    control_value,
    is_private_or_system_trait,
    read_value,
    safe_anywidget_state,
    summarize_file_value,
)

_DATAFRAME_TYPE_RULES = (
    ("pandas", "dataframe"),
    ("polars", "dataframe"),
    ("pyarrow", "table"),
)


def shape(value: Any) -> dict[str, int] | None:
    for source in metadata_sources(value):
        source_shape = getattr(source, "shape", None)
        if isinstance(source_shape, tuple) and len(source_shape) >= 2:
            return {"rows": int(source_shape[0]), "columns": int(source_shape[1])}
        height = getattr(source, "height", None)
        width = getattr(source, "width", None)
        if isinstance(height, int) and isinstance(width, int):
            return {"rows": height, "columns": width}
        rows = getattr(source, "rows", None)
        source_columns = getattr(source, "columns", None)
        if isinstance(rows, Sequence) and isinstance(source_columns, Sequence):
            return {"rows": len(rows), "columns": len(source_columns)}
        num_rows = getattr(source, "num_rows", None)
        num_columns = getattr(source, "num_columns", None)
        if isinstance(num_rows, int) and isinstance(num_columns, int):
            return {"rows": num_rows, "columns": num_columns}
        row_count = getattr(source, "row_count", None)
        schema = getattr(source, "schema", None)
        schema_columns, _dtypes = schema_columns_and_dtypes(schema)
        if isinstance(row_count, int) and schema_columns is not None:
            return {"rows": row_count, "columns": len(list(schema_columns))}
    return None


def columns(value: Any) -> list[dict[str, Any]]:
    source_columns: Any = None
    dtypes: Any = None
    for source in metadata_sources(value):
        schema_columns, schema_dtypes = schema_columns_and_dtypes(
            getattr(source, "schema", None)
        )
        if schema_columns is not None:
            source_columns = schema_columns
            dtypes = schema_dtypes
            break
        source_columns = getattr(source, "columns", None)
        dtypes = getattr(source, "dtypes", None)
        if source_columns is not None:
            break
    if source_columns is None:
        return []

    result: list[dict[str, Any]] = []
    try:
        column_items = (
            list(source_columns.keys())
            if isinstance(source_columns, Mapping)
            else list(source_columns)
        )
    except TypeError:
        return []
    if isinstance(source_columns, Mapping) and dtypes is None:
        dtypes = source_columns
    for index, column in enumerate(column_items[:80]):
        name, dtype = column_name_and_dtype(column, index, dtypes)
        result.append({"name": name, "dtype": dtype})
    return result


def metadata_sources(value: Any) -> list[Any]:
    sources = [value]
    widget = getattr(value, "widget", None)
    if widget is not None and widget is not value:
        sources.append(widget)
    return sources


def schema_columns_and_dtypes(schema: Any) -> tuple[Any | None, Any | None]:
    if isinstance(schema, Mapping):
        return list(schema.keys()), schema
    names = getattr(schema, "names", None)
    if isinstance(names, Sequence) and not isinstance(names, (str, bytes, bytearray)):
        dtypes: dict[str, Any] = {}
        for index, name in enumerate(names):
            dtype = None
            field = _schema_field(schema, name, index)
            if field is not None:
                dtype = getattr(field, "type", None)
            if dtype is None:
                types = getattr(schema, "types", None)
                try:
                    dtype = types[index] if types is not None else None
                except Exception:
                    dtype = None
            if dtype is not None:
                dtypes[str(name)] = dtype
        return list(names), dtypes
    fields = getattr(schema, "fields", None)
    if fields is not None:
        try:
            return list(fields), None
        except TypeError:
            pass
    if isinstance(schema, Sequence) and not isinstance(schema, (str, bytes, bytearray)):
        return schema, None
    if schema is not None and not isinstance(schema, (str, bytes, bytearray)):
        try:
            return list(schema), None
        except TypeError:
            pass
    return None, None


def _schema_field(schema: Any, name: Any, index: int) -> Any:
    field = getattr(schema, "field", None)
    if callable(field):
        for key in (name, index):
            try:
                return field(key)
            except Exception:
                continue
    try:
        return schema[index]
    except Exception:
        return None


def is_svg_html(value: Any) -> bool:
    module = type(value).__module__.lower()
    qualname = type(value).__qualname__.lower()
    if "marimo" not in module or qualname != "html":
        return False
    text = str(getattr(value, "text", "") or getattr(value, "_text", "") or "")
    return "<svg" in text.lower()


def column_name_and_dtype(
    column: Any,
    index: int,
    dtypes: Any,
) -> tuple[str, str | None]:
    if isinstance(column, Mapping):
        name = str(
            column.get("name")
            or column.get("field")
            or column.get("key")
            or column.get("id")
            or index
        )
        dtype = column.get("dtype") or column.get("type")
        return name, str(dtype) if dtype is not None else None
    field_name = getattr(column, "name", None)
    if field_name is not None:
        field_type = getattr(column, "type", None)
        return str(field_name), str(field_type) if field_type is not None else None
    if isinstance(column, Sequence) and not isinstance(column, (str, bytes, bytearray)):
        items = list(column)
        if items:
            name = str(items[0])
            dtype = str(items[1]) if len(items) > 1 and items[1] is not None else None
            return name, dtype

    name = str(column)
    dtype = None
    if dtypes is not None:
        try:
            dtype = str(dtypes[index])
        except Exception:
            try:
                dtype = str(dtypes[name])
            except Exception:
                dtype = None
    return name, dtype


def tabular_summary(
    name: str,
    value: Any,
    value_shape: Mapping[str, int] | None,
) -> str:
    del value
    if value_shape:
        return f"{name}: {value_shape['rows']} rows x {value_shape['columns']} columns"
    return f"{name}: dataframe"


def visualization_summary(
    name: str,
    value_columns: Sequence[Mapping[str, Any]],
) -> str:
    fields = ", ".join(str(column["name"]) for column in value_columns[:5])
    return f"{name}: visualization" + (f" over {fields}" if fields else "")


def inspected_target(
    *,
    kind: str,
    family: str,
    summary: str,
    shape: Mapping[str, int] | None = None,
    columns: Sequence[Mapping[str, Any]] = (),
    chart: Mapping[str, Any] | None = None,
    component: str | None = None,
    component_metadata: Mapping[str, Any] | None = None,
    capability_flags: Mapping[str, bool] | None = None,
    surfaces: Sequence[str] = (),
    context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "kind": kind,
        "family": family,
        "shape": shape,
        "columns": list(columns),
        "capabilities": target_capabilities(**dict(capability_flags or {})),
        "selectionPolicy": selection_policy(*surfaces, context=context),
        "summary": summary,
    }
    if chart is not None:
        metadata["chart"] = dict(chart)
    if component is not None:
        metadata["component"] = component
    if component_metadata is not None:
        metadata["componentMetadata"] = dict(component_metadata)
    return metadata


def is_dataframe_like(
    value: Any,
    value_columns: Sequence[Mapping[str, Any]],
    value_shape: Mapping[str, int] | None,
) -> bool:
    module = type(value).__module__.lower()
    qualname = type(value).__qualname__.lower()
    if any(
        module.startswith(module_name) and qualname == type_name
        for module_name, type_name in _DATAFRAME_TYPE_RULES
    ):
        return True
    return bool(value_columns) and value_shape is not None


__all__ = [
    "column_name_and_dtype",
    "columns",
    "control_summary",
    "control_value",
    "is_dataframe_like",
    "is_private_or_system_trait",
    "is_svg_html",
    "inspected_target",
    "metadata_sources",
    "read_value",
    "safe_anywidget_state",
    "schema_columns_and_dtypes",
    "shape",
    "summarize_file_value",
    "tabular_summary",
    "visualization_summary",
]
