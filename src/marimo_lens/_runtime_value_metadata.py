"""Shared runtime value summarization for controls, widgets, and traitlets."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import anywidget
import traitlets

from ._marimo_runtime import anywidget_state
from ._serialization import MAX_VALUE_ITEMS, preview, safe_value

_SYSTEM_TRAITS = {
    "comm",
    "layout",
    "log",
    "style",
    "keys",
    "tabbable",
    "tooltip",
}


def safe_anywidget_state(widget: anywidget.AnyWidget) -> dict[str, Any]:
    try:
        state = anywidget_state(widget)
    except Exception as exc:
        return {"unavailable": f"{type(exc).__name__}: {exc}"}
    result: dict[str, Any] = {}
    for key, value in state.items():
        if is_private_or_system_trait(key):
            continue
        result[str(key)] = safe_value(value)
        if len(result) >= MAX_VALUE_ITEMS:
            break
    return result


def safe_trait_state(value: traitlets.HasTraits) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in sorted(value.traits().keys()):
        if is_private_or_system_trait(key):
            continue
        try:
            result[key] = safe_value(getattr(value, key))
        except Exception as exc:
            result[key] = {"unavailable": f"{type(exc).__name__}: {exc}"}
        if len(result) >= MAX_VALUE_ITEMS:
            break
    return result


def is_private_or_system_trait(name: str) -> bool:
    return name.startswith("_") or name in _SYSTEM_TRAITS


def control_summary(
    name: str,
    value: Any,
    component_name: str,
    component_args: Mapping[str, Any],
    label: str = "",
) -> str:
    del component_args, label
    current_value = control_value(value, component_name)
    if isinstance(current_value, Mapping) and "unavailable" in current_value:
        return f"{name}: {component_name or type(value).__name__} value unavailable"
    return f"{name}: {component_name or type(value).__name__} = {preview(repr(current_value), 120)}"


def control_value(
    value: Any,
    component_name: str,
) -> Any:
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


__all__ = [
    "control_summary",
    "control_value",
    "is_private_or_system_trait",
    "read_value",
    "safe_anywidget_state",
    "safe_trait_state",
    "summarize_file_value",
]
