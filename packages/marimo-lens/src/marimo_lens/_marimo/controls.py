"""Find the UI controls a cell defines and capture their values."""

from __future__ import annotations

import datetime as dt
import math
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import islice
from typing import Any

import anywidget

from .._notebook import controls
from .._notebook.controls import (
    MAX_CONTROL_CELL_IDS,
    MAX_CONTROL_NODES,
    RuntimeControl,
    ValueBudget,
    identity_is_complete,
    identity_text,
    safe_value,
    type_name,
)
from .._notebook.snapshot import RuntimeCell
from .kernel import RuntimeReadError, read_namespace_value


def collect_controls(
    namespace: Mapping[str, Any],
    definitions: Mapping[str, tuple[str, ...]],
    *,
    cells: Sequence[RuntimeCell],
    output_cell_ids: Sequence[str],
) -> tuple[
    tuple[RuntimeControl, ...],
    frozenset[str],
    frozenset[str],
]:
    cells_by_id = {cell.id: cell for cell in cells}
    defined_names_by_cell: dict[str, list[str]] = {
        cell_id: [] for cell_id in cells_by_id
    }
    for name, defining_cell_ids in definitions.items():
        for cell_id in defining_cell_ids:
            if cell_id in defined_names_by_cell:
                defined_names_by_cell[cell_id].append(name)
    for names in defined_names_by_cell.values():
        names.sort()

    cached: dict[
        str,
        tuple[ControlSource | None, bool],
    ] = {}
    selected: dict[str, ControlSource] = {}
    truncated_outputs: set[str] = set()
    incomplete_outputs: set[str] = set()
    for output_cell_id in output_cell_ids:
        ranked_names = _ranked_control_names(
            output_cell_id,
            cells_by_id,
            defined_names_by_cell,
        )
        retained_for_output = 0
        for name in ranked_names:
            if name not in cached:
                cached[name] = _lookup_control_source(
                    namespace,
                    definitions,
                    name,
                )
            source, complete = cached[name]
            if not complete:
                incomplete_outputs.add(output_cell_id)
            if source is None:
                continue
            if retained_for_output == controls.MAX_CONTROLS:
                truncated_outputs.add(output_cell_id)
                break
            retained_for_output += 1
            selected.setdefault(name, source)

    return (
        tuple(capture_control(source) for source in selected.values()),
        frozenset(truncated_outputs),
        frozenset(incomplete_outputs),
    )


def _ranked_control_names(
    output_cell_id: str,
    cells_by_id: Mapping[str, RuntimeCell],
    defined_names_by_cell: Mapping[str, Sequence[str]],
) -> tuple[str, ...]:
    output = cells_by_id.get(output_cell_id)
    if output is None:
        return ()
    names: list[str] = []
    seen_cells: set[str] = set()
    queue = deque([output_cell_id])

    for name in defined_names_by_cell.get(output_cell_id, ()):
        if not name.startswith("_") and name not in names:
            names.append(name)
    while queue:
        cell_id = queue.popleft()
        if cell_id in seen_cells:
            continue
        seen_cells.add(cell_id)
        cell = cells_by_id.get(cell_id)
        if cell is None:
            continue
        for name in cell.refs:
            if not name.startswith("_") and name not in names:
                names.append(name)
        queue.extend(
            parent_id
            for parent_id in cell.upstream_cell_ids
            if parent_id in cells_by_id and parent_id not in seen_cells
        )
    return tuple(names)


def _lookup_control_source(
    namespace: Mapping[str, Any],
    definitions: Mapping[str, tuple[str, ...]],
    name: str,
) -> tuple[ControlSource | None, bool]:
    try:
        value = read_namespace_value(namespace, name)
    except KeyError:
        return None, True
    except RuntimeReadError:
        return None, False

    return (
        identify_control(
            name=name,
            definition_cell_ids=definitions.get(name, ()),
            value=value,
        ),
        True,
    )


@dataclass(frozen=True, slots=True)
class ControlSource:
    name: str
    cell_ids: tuple[str, ...]
    source: Any
    widget: anywidget.AnyWidget | None
    definition_ids_complete: bool


class _ControlReadError(RuntimeError):
    """A host-owned control attribute could not be read."""


def identify_control(
    *,
    name: str,
    definition_cell_ids: Sequence[str],
    value: Any,
) -> ControlSource | None:
    """Return detached control identity without reading synchronized state."""

    widget: anywidget.AnyWidget | None
    source: Any
    if isinstance(value, anywidget.AnyWidget):
        widget = value
        source = value
    elif _is_ui_element(value):
        widget = _ui_element_widget(value)
        source = widget if widget is not None else value
    else:
        return None
    if widget is not None and _is_lens_widget(widget):
        return None

    cell_ids = tuple(islice(definition_cell_ids, MAX_CONTROL_CELL_IDS))
    return ControlSource(
        name=name,
        cell_ids=cell_ids,
        source=source,
        widget=widget,
        definition_ids_complete=len(definition_cell_ids) <= MAX_CONTROL_CELL_IDS,
    )


def capture_control(source: ControlSource) -> RuntimeControl:
    """Read one admitted control into an immutable bounded representation."""

    kind = "anywidget" if source.widget is not None else "marimo-ui"
    if source.widget is not None:
        component = type_name(source.widget)
        label = ""
        init_args: Mapping[str, Any] = {}
        init_metadata_complete = True
    else:
        component, label, init_args, init_metadata_complete = _ui_metadata(
            source.source
        )
    safe_component = identity_text(component, fallback="unknown")
    safe_label = identity_text(label, fallback="", allow_empty=True)
    metadata_complete = (
        source.definition_ids_complete
        and init_metadata_complete
        and identity_is_complete(component)
        and identity_is_complete(label)
    )
    if kind == "anywidget":
        value_budget = ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
        value_budget.opaque = True
        visible_value = None
        captured_sensitive = True
        state_complete = False
    else:
        sensitive, state_incomplete = _ui_value_policy(
            source.source,
            init_args=init_args,
            metadata_complete=init_metadata_complete,
        )
        if not state_incomplete:
            visible_value, value_budget, captured_sensitive = _capture_ui_value(
                source.source,
                sensitive=sensitive,
            )
            state_complete = not captured_sensitive
        else:
            value_budget = ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
            value_budget.opaque = True
            visible_value = None
            captured_sensitive = True
            state_complete = False
    return RuntimeControl(
        name=source.name,
        cell_ids=source.cell_ids,
        kind=kind,
        component=safe_component,
        label=safe_label,
        value=visible_value,
        value_nodes=MAX_CONTROL_NODES - value_budget.remaining_nodes,
        complete=(
            state_complete and not value_budget.truncated and not value_budget.opaque
        ),
        sensitive=captured_sensitive,
        metadata_complete=metadata_complete,
    )


def _ui_element_widget(value: Any) -> anywidget.AnyWidget | None:
    # UI element descriptors may execute application code during attribute access.
    try:
        widget = _read_ui_widget(value)
    except _ControlReadError:
        return None
    return widget if isinstance(widget, anywidget.AnyWidget) else None


def _read_ui_widget(value: Any) -> Any:
    try:
        return getattr(value, "widget", None)
    except Exception as error:
        raise _ControlReadError from error


def _is_ui_element(value: Any) -> bool:
    try:
        from marimo._plugins.ui._core.ui_element import UIElement
    except ImportError:
        return False
    return isinstance(value, UIElement)


def _ui_metadata(value: Any) -> tuple[str, str, Mapping[str, Any], bool]:
    # Private marimo descriptors can fail independently across supported versions.
    try:
        component, label, init_args = _read_ui_metadata(value)
    except _ControlReadError:
        return type_name(value), "", {}, False
    if not isinstance(init_args, Mapping):
        return component or type_name(value), label, {}, False
    return component or type_name(value), label, init_args, True


def _read_ui_metadata(value: Any) -> tuple[str, str, Any]:
    try:
        args = value._args
        component = str(args.component_name or "")
        label = str(args.label or "")
        init_args = args.args
    except Exception as error:
        raise _ControlReadError from error
    return component, label, init_args


def _ui_value_policy(
    value: Any,
    *,
    init_args: Mapping[str, Any],
    metadata_complete: bool,
) -> tuple[bool, bool]:
    native = type(value).__module__.startswith("marimo._plugins.ui.")
    direct_password = native and init_args.get("kind") == "password"
    composite = any(key in init_args for key in ("element-id", "element-ids"))
    state_incomplete = not native or not metadata_complete or composite
    return direct_password or state_incomplete, state_incomplete


_MISSING = object()


def _capture_ui_value(
    value: Any,
    *,
    sensitive: bool,
) -> tuple[Any, ValueBudget, bool]:
    value_budget = ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
    if sensitive:
        value_budget.opaque = True
        return None, value_budget, True
    frontend_value: Any = _MISSING
    # Frontend state can invoke application code while being read or normalized.
    try:
        frontend_value, shown = _read_safe_frontend_value(
            value,
            budget=value_budget,
        )
    except _ControlReadError as error:
        value_budget.opaque = True
        source_error = error.__cause__
        shown = safe_value(
            {
                "unavailable": type_name(
                    source_error if source_error is not None else error
                )
            },
            budget=value_budget,
        )

    value_complete = not value_budget.truncated and not value_budget.opaque
    can_show = (
        value_complete
        and frontend_value is not _MISSING
        and _ui_value_can_be_shown(frontend_value)
    )
    return shown if can_show else None, value_budget, not can_show


def _read_safe_frontend_value(
    value: Any,
    *,
    budget: ValueBudget,
) -> tuple[Any, Any]:
    try:
        frontend_value = value._value_frontend
        return frontend_value, safe_value(frontend_value, budget=budget)
    except Exception as error:
        raise _ControlReadError from error


def _ui_value_can_be_shown(value: Any) -> bool:
    if _ui_scalar_can_be_shown(value):
        return True
    if isinstance(value, (list, tuple)):
        return all(_ui_scalar_can_be_shown(item) for item in value)
    return False


def _ui_scalar_can_be_shown(value: Any) -> bool:
    if value is None or isinstance(value, (bool, int, str, dt.date, dt.time)):
        return True
    return isinstance(value, float) and math.isfinite(value)


def _is_lens_widget(widget: anywidget.AnyWidget) -> bool:
    # Trait-backed markers may execute application code during attribute access.
    try:
        return _read_lens_marker(widget) is True
    except _ControlReadError:
        return False


def _read_lens_marker(widget: anywidget.AnyWidget) -> Any:
    try:
        return getattr(widget, "_marimo_lens_widget", False)
    except Exception as error:
        raise _ControlReadError from error
