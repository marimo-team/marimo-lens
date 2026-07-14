"""Collect a bounded snapshot from the active marimo runtime."""

from __future__ import annotations

import json
import math
import pathlib
from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from itertools import islice
from typing import Any, cast

import anywidget

MAX_VALUE_ITEMS = 20
MAX_VALUE_DEPTH = 4
MAX_VALUE_STRING = 1_000
MAX_VALUE_NODES = 512
MAX_CONTROLS = 16
MAX_CONTROL_CELL_IDS = 16
MAX_CONTROL_NODES = 512
MAX_CONTROL_CHARACTERS = 8_000


@dataclass(frozen=True, slots=True)
class RuntimeCell:
    id: str
    code: str
    defs: tuple[str, ...]
    refs: tuple[str, ...]
    upstream_cell_ids: tuple[str, ...]
    language: str


@dataclass(frozen=True, slots=True)
class RuntimeControl:
    name: str
    cell_ids: tuple[str, ...]
    kind: str
    component: str
    label: str
    value: Any


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    available: bool
    filename: str
    reason: str
    cells: tuple[RuntimeCell, ...]
    controls: tuple[RuntimeControl, ...]


@dataclass(slots=True)
class _ValueBudget:
    remaining_nodes: int = MAX_VALUE_NODES
    truncated: bool = False


@dataclass(frozen=True, slots=True)
class _ControlValueSource:
    kind: str
    value: Any


@dataclass(frozen=True, slots=True)
class SerializedControls:
    controls: tuple[RuntimeControl, ...]
    state_truncated: bool


def collect_runtime_snapshot() -> RuntimeSnapshot:
    """Read cells, lineage, and controls from the current marimo kernel."""

    try:
        from marimo._runtime.context import get_context
        from marimo._runtime.context.types import ContextNotInitializedError
    except Exception:
        return _unavailable("marimo runtime is unavailable")

    try:
        context = get_context()
    except ContextNotInitializedError:
        return _unavailable("not running in a marimo kernel")
    except Exception as error:
        return _unavailable(f"{type(error).__name__}: {error}")

    graph = getattr(context, "graph", None)
    if graph is None:
        return _unavailable("marimo runtime has no dataflow graph")

    with _graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return _unavailable("marimo dataflow graph has no cells")
        cell_items = tuple(raw_cells.items())
        cell_ids = [str(cell_id) for cell_id, _cell in cell_items]
        cell_order = {cell_id: index for index, cell_id in enumerate(cell_ids)}
        definitions = _definitions(graph, cell_order)
        parents = _parents(graph, cell_ids, cell_order)
    namespace = _runtime_globals(context)

    cells = tuple(
        _runtime_cell(
            str(cell_id),
            cell,
            upstream_cell_ids=parents.get(str(cell_id), ()),
        )
        for cell_id, cell in cell_items
    )
    controls = _collect_controls(namespace, definitions)
    return RuntimeSnapshot(
        available=True,
        filename=str(getattr(context, "filename", "") or ""),
        reason="",
        cells=cells,
        controls=controls,
    )


def _runtime_cell(
    cell_id: str,
    cell: Any,
    *,
    upstream_cell_ids: tuple[str, ...],
) -> RuntimeCell:
    code = str(getattr(cell, "code", "") or "")
    refs = tuple(sorted(str(name) for name in getattr(cell, "refs", ()) or ()))
    return RuntimeCell(
        id=cell_id,
        code=code,
        defs=tuple(sorted(str(name) for name in getattr(cell, "defs", ()) or ())),
        refs=refs,
        upstream_cell_ids=upstream_cell_ids,
        language=str(getattr(cell, "language", "python") or "python"),
    )


def _definitions(
    graph: Any,
    cell_order: Mapping[str, int],
) -> dict[str, tuple[str, ...]]:
    raw_definitions = getattr(graph, "definitions", {})
    if not isinstance(raw_definitions, Mapping):
        return {}
    fallback_order = len(cell_order)
    return {
        str(name): tuple(
            sorted(
                (str(cell_id) for cell_id in defining_cells),
                key=lambda cell_id: (cell_order.get(cell_id, fallback_order), cell_id),
            )
        )
        for name, defining_cells in raw_definitions.items()
    }


def _parents(
    graph: Any,
    cell_ids: Sequence[str],
    cell_order: Mapping[str, int],
) -> dict[str, tuple[str, ...]]:
    fallback_order = len(cell_order)
    raw_parents = getattr(graph, "parents", None)
    if isinstance(raw_parents, Mapping):
        return {
            cell_id: tuple(
                sorted(
                    (str(parent) for parent in raw_parents.get(cell_id, ())),
                    key=lambda parent: (
                        cell_order.get(parent, fallback_order),
                        parent,
                    ),
                )
            )
            for cell_id in cell_ids
        }

    result: dict[str, list[str]] = {cell_id: [] for cell_id in cell_ids}
    raw_children = getattr(graph, "children", {})
    if isinstance(raw_children, Mapping):
        for parent, children in raw_children.items():
            parent_id = str(parent)
            for child in children:
                result.setdefault(str(child), []).append(parent_id)
    return {
        cell_id: tuple(
            sorted(
                parent_ids,
                key=lambda parent: (cell_order.get(parent, fallback_order), parent),
            )
        )
        for cell_id, parent_ids in result.items()
    }


def _runtime_globals(context: Any) -> dict[str, Any]:
    try:
        value = getattr(context, "globals", {}) or {}
    except Exception:
        return {}
    return dict(value) if isinstance(value, Mapping) else {}


def _collect_controls(
    namespace: Mapping[str, Any],
    definitions: Mapping[str, tuple[str, ...]],
) -> tuple[RuntimeControl, ...]:
    controls: list[RuntimeControl] = []
    for raw_name, value in namespace.items():
        name = str(raw_name)
        if name.startswith("_"):
            continue
        cell_ids = definitions.get(name, ())

        if isinstance(value, anywidget.AnyWidget):
            widget = value
        elif _is_ui_element(value):
            widget = _ui_element_widget(value)
        else:
            continue

        if widget is not None:
            if _is_lens_widget(widget):
                continue
            controls.append(
                RuntimeControl(
                    name=name,
                    cell_ids=cell_ids,
                    kind="anywidget",
                    component=_type_name(widget),
                    label="",
                    value=_ControlValueSource("anywidget", widget),
                )
            )
        else:
            component, label = _ui_identity(value)
            controls.append(
                RuntimeControl(
                    name=name,
                    cell_ids=cell_ids,
                    kind="marimo-ui",
                    component=component,
                    label=label,
                    value=_ControlValueSource("marimo-ui", value),
                )
            )
    return tuple(controls)


def _ui_element_widget(value: Any) -> anywidget.AnyWidget | None:
    try:
        widget = getattr(value, "widget", None)
    except Exception:
        return None
    return widget if isinstance(widget, anywidget.AnyWidget) else None


def _is_ui_element(value: Any) -> bool:
    try:
        from marimo._plugins.ui._core.ui_element import UIElement
    except Exception:
        return False
    return isinstance(value, UIElement)


def _ui_identity(value: Any) -> tuple[str, str]:
    args = getattr(value, "_args", None)
    component = str(
        getattr(args, "component_name", None) or getattr(value, "_name", "") or ""
    )
    label = str(getattr(args, "label", None) or "")
    return component or _type_name(value), label


def serialize_controls(
    controls: Sequence[RuntimeControl],
) -> SerializedControls:
    """Resolve relevant controls through one exact serialized-state budget."""

    budget = _ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
    metadata: list[RuntimeControl] = []
    candidate_values: list[Any] = []
    for control in controls:
        metadata.append(
            RuntimeControl(
                name=_identity_text(control.name, fallback="unknown-control"),
                cell_ids=tuple(
                    _identity_text(cell_id, fallback="unknown-cell")
                    for cell_id in islice(control.cell_ids, MAX_CONTROL_CELL_IDS)
                ),
                kind=_identity_text(control.kind, fallback="unknown"),
                component=_identity_text(control.component, fallback="unknown"),
                label=_identity_text(control.label, fallback="", allow_empty=True),
                value=None,
            )
        )
        candidate_values.append(_safe_control_value(control.value, budget))

    values, character_truncated = _fit_control_states(candidate_values)
    serialized = tuple(
        RuntimeControl(
            name=control.name,
            cell_ids=control.cell_ids,
            kind=control.kind,
            component=control.component,
            label=control.label,
            value=value,
        )
        for control, value in zip(metadata, values, strict=True)
    )
    return SerializedControls(
        controls=serialized,
        state_truncated=budget.truncated or character_truncated,
    )


def _safe_control_value(value: Any, budget: _ValueBudget) -> Any:
    if isinstance(value, _ControlValueSource):
        if value.kind == "anywidget":
            return _safe_anywidget_state(value.value, budget)
        return _safe_ui_value(value.value, budget)
    return _safe_value(value, budget=budget)


def _safe_ui_value(value: Any, budget: _ValueBudget) -> Any:
    try:
        return _safe_value(getattr(value, "value"), budget=budget)
    except Exception as error:
        return _safe_value({"unavailable": _type_name(error)}, budget=budget)


def _safe_anywidget_state(
    widget: anywidget.AnyWidget,
    budget: _ValueBudget,
) -> Any:
    try:
        from marimo._plugins.ui._impl.from_anywidget import get_anywidget_state

        state = get_anywidget_state(widget)
    except Exception:
        try:
            state = widget.get_state()
        except Exception as error:
            return _safe_value({"unavailable": _type_name(error)}, budget=budget)
    try:
        return _safe_value(state, budget=budget)
    except Exception as error:
        return _safe_value({"unavailable": _type_name(error)}, budget=budget)


def _safe_value(
    value: Any,
    *,
    depth: int = 0,
    ancestors: set[int] | None = None,
    budget: _ValueBudget | None = None,
) -> Any:
    budget = _ValueBudget() if budget is None else budget
    if budget.remaining_nodes <= 0:
        budget.truncated = True
        return {"truncated": "value node budget reached"}
    budget.remaining_nodes -= 1

    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value.bit_length() > 4_096:
            budget.truncated = True
            return {
                "type": _bounded_text(_type_name(value), budget),
                "truncated": "integer bit limit reached",
            }
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else {"type": "float", "repr": repr(value)}
    if isinstance(value, str):
        return _bounded_text(value, budget)
    if isinstance(value, (bytes, bytearray, memoryview)):
        byte_count = value.nbytes if isinstance(value, memoryview) else len(value)
        return {"type": type(value).__name__, "bytes": byte_count}
    if depth >= MAX_VALUE_DEPTH:
        budget.truncated = True
        return {
            "type": _bounded_text(_type_name(value), budget),
            "truncated": "maximum value depth reached",
        }

    ancestors = set() if ancestors is None else ancestors
    marker = id(value)
    if marker in ancestors:
        return {
            "type": _bounded_text(_type_name(value), budget),
            "cycle": True,
        }
    ancestors.add(marker)
    try:
        if isinstance(value, Mapping):
            try:
                keys = list(islice(iter(value), MAX_VALUE_ITEMS + 1))
            except Exception:
                return _describe(value, budget)
            mapping_result: dict[str, Any] = {}
            for key in keys[:MAX_VALUE_ITEMS]:
                if budget.remaining_nodes <= 0:
                    budget.truncated = True
                    break
                try:
                    safe_key = _bounded_text(str(key), budget)
                    item = value[key]
                except Exception:
                    continue
                mapping_result[safe_key] = _safe_value(
                    item,
                    depth=depth + 1,
                    ancestors=ancestors,
                    budget=budget,
                )
            if len(keys) > MAX_VALUE_ITEMS or budget.remaining_nodes <= 0:
                budget.truncated = True
                mapping_result["..."] = "more items omitted"
            return mapping_result
        if isinstance(value, (list, tuple, set, frozenset)):
            try:
                items = list(islice(iter(value), MAX_VALUE_ITEMS + 1))
            except Exception:
                return _describe(value, budget)
            sequence_result: list[Any] = []
            for item in items[:MAX_VALUE_ITEMS]:
                if budget.remaining_nodes <= 0:
                    budget.truncated = True
                    break
                sequence_result.append(
                    _safe_value(
                        item,
                        depth=depth + 1,
                        ancestors=ancestors,
                        budget=budget,
                    )
                )
            if len(items) > MAX_VALUE_ITEMS or budget.remaining_nodes <= 0:
                budget.truncated = True
                sequence_result.append("... more items omitted")
            return sequence_result
        return _describe(value, budget)
    finally:
        ancestors.remove(marker)


def _describe(value: Any, budget: _ValueBudget) -> dict[str, str]:
    return {"type": _bounded_text(_type_name(value), budget)}


def _bounded_text(value: str, budget: _ValueBudget) -> str:
    result, truncated = _bounded_unicode(value)
    if truncated:
        budget.truncated = True
    return result


def _identity_text(
    value: str,
    *,
    fallback: str,
    allow_empty: bool = False,
) -> str:
    result, _truncated = _bounded_unicode(value)
    if result or allow_empty:
        return result
    return fallback


def _bounded_unicode(value: str) -> tuple[str, bool]:
    truncated = len(value) > MAX_VALUE_STRING
    raw = value[: MAX_VALUE_STRING - 3] + "..." if truncated else value
    return (
        "".join(
            "\N{REPLACEMENT CHARACTER}"
            if 0xD800 <= ord(character) <= 0xDFFF
            else character
            for character in raw
        ),
        truncated,
    )


def _fit_control_states(values: Sequence[Any]) -> tuple[tuple[Any, ...], bool]:
    marker = _control_state_character_marker()
    marker_characters = _json_characters(marker)
    total_characters = 2 + max(0, len(values) - 1) + marker_characters * len(values)
    if total_characters > MAX_CONTROL_CHARACTERS:
        raise RuntimeError("Control state markers exceed the serialization budget.")

    result: list[Any] = []
    truncated = False
    for value in values:
        value_characters = _json_characters(value)
        if (
            total_characters - marker_characters + value_characters
            <= MAX_CONTROL_CHARACTERS
        ):
            result.append(value)
            total_characters += value_characters - marker_characters
        else:
            result.append(_control_state_character_marker())
            truncated = True

    serialized = tuple(result)
    exact_characters = _json_characters(serialized)
    if (
        exact_characters != total_characters
        or exact_characters > MAX_CONTROL_CHARACTERS
    ):
        raise RuntimeError("Control state serialization exceeded its budget.")
    return serialized, truncated


def _control_state_character_marker() -> dict[str, str]:
    return {"truncated": "control state character budget reached"}


def _json_characters(value: Any) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    )


def _type_name(value: Any) -> str:
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


def _is_lens_widget(widget: anywidget.AnyWidget) -> bool:
    try:
        return getattr(widget, "_marimo_lens_widget", False) is True
    except Exception:
        return False


def _graph_lock(value: Any) -> AbstractContextManager[Any]:
    if hasattr(value, "__enter__") and hasattr(value, "__exit__"):
        return cast(AbstractContextManager[Any], value)
    return nullcontext()


def _unavailable(reason: str) -> RuntimeSnapshot:
    return RuntimeSnapshot(
        available=False,
        filename="",
        reason=reason,
        cells=(),
        controls=(),
    )


def notebook_name(filename: str) -> str:
    return pathlib.Path(filename).name if filename else ""


__all__ = [
    "RuntimeCell",
    "RuntimeControl",
    "RuntimeSnapshot",
    "collect_runtime_snapshot",
    "serialize_controls",
]
