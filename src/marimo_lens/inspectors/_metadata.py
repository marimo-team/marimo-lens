"""Shared metadata helpers for built-in inspectors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import anywidget

from .._marimo_runtime import anywidget_state as _anywidget_state
from .._serialization import (
    MAX_VALUE_ITEMS,
    preview,
    safe_value,
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
    return None


def columns(value: Any) -> list[dict[str, Any]]:
    source_columns: Any = None
    dtypes: Any = None
    for source in metadata_sources(value):
        source_columns = getattr(source, "columns", None)
        dtypes = getattr(source, "dtypes", None)
        if source_columns is None and hasattr(source, "schema"):
            schema = getattr(source, "schema", {})
            if isinstance(schema, Mapping):
                source_columns = list(schema.keys())
                dtypes = schema
        if source_columns is not None:
            break
    if source_columns is None:
        return []

    result: list[dict[str, Any]] = []
    column_items = (
        list(source_columns.keys())
        if isinstance(source_columns, Mapping)
        else list(source_columns)
    )
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


def safe_anywidget_state(widget: anywidget.AnyWidget) -> dict[str, Any]:
    try:
        state = _anywidget_state(widget)
    except Exception as exc:
        return {"unavailable": f"{type(exc).__name__}: {exc}"}
    result: dict[str, Any] = {}
    for key, value in state.items():
        if is_private_or_system_trait(key):
            continue
        result[str(key)] = safe_value(value, key=key)
        if len(result) >= MAX_VALUE_ITEMS:
            break
    return result


def is_private_or_system_trait(name: str) -> bool:
    return name.startswith("_") or name in {
        "comm",
        "layout",
        "log",
        "style",
        "keys",
        "tabbable",
        "tooltip",
    }


def control_summary(
    name: str,
    value: Any,
    component_name: str,
    component_args: Mapping[str, Any],
    label: str = "",
) -> str:
    current_value = control_value(value, component_name, component_args, name, label)
    if isinstance(current_value, Mapping) and "unavailable" in current_value:
        return f"{name}: {component_name or type(value).__name__} value unavailable"
    return f"{name}: {component_name or type(value).__name__} = {preview(repr(current_value), 120)}"


def control_value(
    value: Any,
    component_name: str,
    component_args: Mapping[str, Any],
    name: str = "",
    label: str = "",
) -> Any:
    _ = (component_args, name, label)
    if "file" in component_name:
        return summarize_file_value(read_value(value))
    return safe_value(read_value(value))


def read_value(value: Any) -> Any:
    try:
        return getattr(value, "value")
    except Exception as exc:
        return {"unavailable": f"{type(exc).__name__}: {exc}"}


def summarize_file_value(value: Any) -> Any:
    if value is None:
        return None
    files = value if isinstance(value, list) else [value]
    result = []
    for item in files[:MAX_VALUE_ITEMS]:
        result.append(
            {
                "name": safe_value(getattr(item, "name", None)),
                "size": safe_value(getattr(item, "size", None)),
                "type": safe_value(getattr(item, "type", None)),
            }
            if not isinstance(item, Mapping)
            else {
                "name": safe_value(item.get("name")),
                "size": safe_value(item.get("size")),
                "type": safe_value(item.get("type")),
            }
        )
    return result


def is_dataframe_like(
    value: Any,
    value_columns: Sequence[Mapping[str, Any]],
    value_shape: Mapping[str, int] | None,
) -> bool:
    module = type(value).__module__.lower()
    qualname = type(value).__qualname__.lower()
    if "pandas" in module and qualname == "dataframe":
        return True
    if "polars" in module and "dataframe" in qualname:
        return True
    if "pyarrow" in module and "table" in qualname:
        return True
    return bool(value_columns) and value_shape is not None
