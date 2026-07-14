"""Live marimo notebook and runtime context collection."""

from __future__ import annotations

import ast
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from numbers import Number
from typing import Any
from urllib.parse import parse_qsl

import anywidget
import traitlets

from ._marimo_runtime import (
    is_marimo_ui_element as _is_marimo_ui_element,
    runtime_context as _runtime_context,
    runtime_globals as _runtime_globals,
)
from ._serialization import (
    MAX_CONTEXT_ITEMS as _MAX_CONTEXT_ITEMS,
    preview as _preview,
    safe_argv as _safe_argv,
    safe_value as _safe_value,
)
from ._target_payload import python_type_name
from .inspectors import EntityRegistry
from .metadata import (
    _is_internal_name,
    _is_lens_widget,
    _summarize_anywidget,
    _summarize_namespace,
    _summarize_traitlets_object,
    _summarize_ui_element,
)


@dataclass(frozen=True)
class Source:
    """A typed source for Lens collection.

    ``Lens()`` uses ``runtime()`` by default. Tests and replay tools should pass
    ``mapping(...)`` or ``snapshot(...)`` so deterministic collection is explicit
    instead of hidden behind constructor flags.
    """

    namespace: Mapping[str, Any] | None = None
    notebook: Mapping[str, Any] | None = None
    cell_outputs: Mapping[str, Any] | None = None
    auto_collect: bool = True
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Snapshot:
    """An offline notebook snapshot used for replay or fixture tests."""

    namespace: Mapping[str, Any] = field(default_factory=dict)
    notebook: Mapping[str, Any] = field(default_factory=dict)
    cell_outputs: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class State:
    """Restorable Lens state.

    Human annotations and agent receipts are state, not collection source. Keeping
    them here keeps the normal ``Lens(...)`` path focused on collected notebook context.
    """

    title: str | None = None
    source: Source | None = None
    snapshot: Snapshot | None = None
    targets: Sequence[Any] = ()
    annotations: Sequence[Mapping[str, Any]] = ()
    agent_activity: Sequence[Mapping[str, Any]] = ()
    agent_commands: Sequence[Mapping[str, Any]] = ()


def runtime() -> Source:
    """Collect from the active marimo runtime."""

    return Source(auto_collect=True)


def mapping(
    namespace: Mapping[str, Any],
    *,
    notebook: Mapping[str, Any] | None = None,
    cell_outputs: Mapping[str, Any] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> Source:
    """Collect from an explicit namespace without falling back to runtime globals."""

    return Source(
        namespace=namespace,
        notebook=notebook,
        cell_outputs=dict(cell_outputs or {}),
        auto_collect=False,
        metadata=dict(metadata or {}),
    )


def snapshot(value: Snapshot) -> Source:
    """Collect from a frozen notebook snapshot."""

    return Source(
        namespace=value.namespace,
        notebook=value.notebook,
        cell_outputs=value.cell_outputs,
        auto_collect=False,
        metadata=value.metadata,
    )


def collect_notebook_graph(
    namespace: Mapping[str, Any] | None = None,
    *,
    entity_registry: EntityRegistry | None = None,
) -> dict[str, Any]:
    """Return a JSON-safe snapshot of the live marimo dataflow graph."""

    collected_at = _utcnow()
    ctx, reason = _runtime_context()
    runtime_namespace = _runtime_globals(ctx) if namespace is None else namespace
    if ctx is None:
        return {
            "available": False,
            "collectedAt": collected_at,
            "reason": reason or "marimo runtime unavailable",
            "globals": _summarize_namespace(
                runtime_namespace,
                entity_registry=entity_registry,
            ),
            "controls": collect_runtime_context(runtime_namespace),
        }

    graph = getattr(ctx, "graph", None)
    if graph is None:
        return {
            "available": False,
            "collectedAt": collected_at,
            "reason": "runtime context has no graph",
            "globals": _summarize_namespace(
                runtime_namespace,
                entity_registry=entity_registry,
            ),
            "controls": collect_runtime_context(runtime_namespace),
        }

    cells: list[dict[str, Any]] = []
    for cell_id, cell in getattr(graph, "cells", {}).items():
        output = getattr(cell, "output", None)
        cells.append(
            {
                "id": str(cell_id),
                "defs": sorted(map(str, getattr(cell, "defs", ()))),
                "refs": sorted(map(str, getattr(cell, "refs", ()))),
                "outputRefs": _output_ref_names(output, runtime_namespace),
                "outputType": _python_type(output) if output is not None else "",
                "hasOutputExpression": _has_output_expression(cell),
                "language": str(getattr(cell, "language", "python")),
                "status": str(getattr(cell, "run_result_status", "") or ""),
                "stale": bool(getattr(cell, "stale", False)),
                "disabled": bool(
                    getattr(getattr(cell, "config", None), "disabled", False)
                ),
                "codePreview": _preview(getattr(cell, "code", "")),
            }
        )

    definitions = {
        str(name): sorted(str(cell_id) for cell_id in cell_ids)
        for name, cell_ids in getattr(graph, "definitions", {}).items()
    }
    edges = [
        {"from": str(parent), "to": str(child)}
        for parent, children in getattr(graph, "children", {}).items()
        for child in children
    ]

    return {
        "available": True,
        "collectedAt": collected_at,
        "currentCellId": str(getattr(ctx, "cell_id", "") or ""),
        "filename": str(getattr(ctx, "filename", "") or ""),
        "cells": cells,
        "definitions": definitions,
        "edges": edges,
        "globals": _summarize_namespace(
            runtime_namespace,
            definitions=definitions,
            entity_registry=entity_registry,
        ),
        "controls": collect_runtime_context(
            runtime_namespace,
            definitions=definitions,
        ),
        "runtime": {
            "sessionMode": str(getattr(ctx, "session_mode", "") or ""),
            "lazy": bool(getattr(ctx, "lazy", False)),
            "queryParams": _safe_value(
                _normalize_query_params(getattr(ctx, "query_params", None))
            ),
            "argv": _safe_argv(list(getattr(ctx, "argv", []) or [])),
        },
    }


def collect_runtime_context(
    namespace: Mapping[str, Any] | None = None,
    *,
    definitions: Mapping[str, Sequence[str]] | None = None,
) -> dict[str, Any]:
    """Return a bounded snapshot of live controls and widget-like objects."""

    if namespace is None:
        ctx, _reason = _runtime_context()
        namespace = _runtime_globals(ctx)
    definitions = definitions or {}
    ui_elements: list[dict[str, Any]] = []
    widgets: list[dict[str, Any]] = []
    traitlets_objects: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for name, value in namespace.items():
        if _is_internal_name(str(name)):
            continue
        try:
            if _is_marimo_ui_element(value):
                ui_elements.append(_summarize_ui_element(str(name), value, definitions))
                continue
            if _is_lens_widget(value):
                continue
            if isinstance(value, anywidget.AnyWidget):
                widgets.append(_summarize_anywidget(str(name), value, definitions))
                continue
            if isinstance(value, traitlets.HasTraits):
                traitlets_objects.append(
                    _summarize_traitlets_object(str(name), value, definitions)
                )
        except Exception as exc:
            errors.append(
                {
                    "name": str(name),
                    "pythonType": python_type_name(value),
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

    ui_element_count = len(ui_elements)
    widget_count = len(widgets)
    traitlets_object_count = len(traitlets_objects)
    error_count = len(errors)
    ui_elements = ui_elements[:_MAX_CONTEXT_ITEMS]
    widgets = widgets[:_MAX_CONTEXT_ITEMS]
    traitlets_objects = traitlets_objects[:_MAX_CONTEXT_ITEMS]
    return {
        "summary": {
            "uiElementCount": ui_element_count,
            "widgetCount": widget_count,
            "traitletsObjectCount": traitlets_object_count,
            "errorCount": error_count,
            "capturedUiElementCount": len(ui_elements),
            "capturedWidgetCount": len(widgets),
            "capturedTraitletsObjectCount": len(traitlets_objects),
            "capturedErrorCount": len(errors[:_MAX_CONTEXT_ITEMS]),
        },
        "uiElements": ui_elements,
        "widgets": widgets,
        "traitletsObjects": traitlets_objects,
        "errors": errors[:_MAX_CONTEXT_ITEMS],
    }


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_output_expression(cell: Any) -> bool:
    module = getattr(cell, "mod", None)
    body = getattr(module, "body", None)
    if isinstance(body, list) and body:
        return isinstance(body[-1], ast.Expr)
    try:
        return getattr(cell, "last_expr", None) is not None
    except Exception:
        return False


def _normalize_query_params(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, str):
        return _query_pairs_to_dict(
            parse_qsl(value.lstrip("?"), keep_blank_values=True)
        )
    if isinstance(value, Mapping):
        return {str(key): item_value for key, item_value in value.items()}

    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        try:
            return _normalize_query_params(to_dict())
        except Exception:
            pass

    items = getattr(value, "items", None)
    if callable(items):
        try:
            item_values = items()
            if isinstance(item_values, Iterable):
                return {str(key): item_value for key, item_value in item_values}
        except Exception:
            pass

    keys = getattr(value, "keys", None)
    if callable(keys):
        try:
            key_values = keys()
            if isinstance(key_values, Iterable):
                return {str(key): value[key] for key in key_values}
        except Exception:
            pass

    try:
        return {str(key): item_value for key, item_value in dict(value).items()}
    except (TypeError, ValueError):
        return {"type": python_type_name(value)}


def _output_ref_names(output: Any, namespace: Mapping[str, Any]) -> list[str]:
    refs: list[str] = []
    if output is None or _is_scalar_identity_value(output):
        return refs
    for raw_name, value in namespace.items():
        name = str(raw_name)
        if _is_internal_name(name) or _is_lens_widget(value):
            continue
        if _is_scalar_identity_value(value):
            continue
        if _contains_identity(output, value, seen=set()):
            refs.append(name)
    return sorted(refs)


def _is_scalar_identity_value(value: Any) -> bool:
    return value is None or isinstance(value, (str, bytes, bytearray, bool, Number))


def _contains_identity(
    candidate: Any,
    needle: Any,
    *,
    seen: set[int],
    depth: int = 0,
) -> bool:
    if candidate is needle:
        return True
    if depth >= 3:
        return False
    marker = id(candidate)
    if marker in seen:
        return False
    seen.add(marker)
    if isinstance(candidate, Mapping):
        values = list(candidate.values())[:_MAX_CONTEXT_ITEMS]
    elif isinstance(candidate, (list, tuple, set, frozenset)):
        values = list(candidate)[:_MAX_CONTEXT_ITEMS]
    else:
        return False
    return any(
        _contains_identity(value, needle, seen=seen, depth=depth + 1)
        for value in values
    )


def _python_type(value: Any) -> str:
    return python_type_name(value)


def _query_pairs_to_dict(pairs: Sequence[tuple[str, str]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key not in result:
            result[key] = value
            continue
        existing = result[key]
        if isinstance(existing, list):
            existing.append(value)
        else:
            result[key] = [existing, value]
    return result
