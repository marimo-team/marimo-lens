"""Adapt private marimo control state into detached Lens records."""

from __future__ import annotations

import datetime as dt
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import islice
from typing import Any

import anywidget

from ._control_state import (
    MAX_CONTROL_CELL_IDS,
    MAX_CONTROL_NODES,
    RuntimeControl,
    _identity_is_complete,
    _identity_text,
    _safe_value,
    _type_name,
    _ValueBudget,
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
        component = _type_name(source.widget)
        label = ""
        init_args: Mapping[str, Any] = {}
        init_metadata_complete = True
    else:
        component, label, init_args, init_metadata_complete = _ui_metadata(
            source.source
        )
    safe_component = _identity_text(component, fallback="unknown")
    safe_label = _identity_text(label, fallback="", allow_empty=True)
    metadata_complete = (
        source.definition_ids_complete
        and init_metadata_complete
        and _identity_is_complete(component)
        and _identity_is_complete(label)
    )
    if kind == "anywidget":
        value_budget = _ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
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
            value_budget = _ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
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
        return _type_name(value), "", {}, False
    if not isinstance(init_args, Mapping):
        return component or _type_name(value), label, {}, False
    return component or _type_name(value), label, init_args, True


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
) -> tuple[Any, _ValueBudget, bool]:
    value_budget = _ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
    if sensitive:
        value_budget.opaque = True
        return None, value_budget, True
    frontend_value: Any = _MISSING
    # Frontend state can invoke application code while being read or normalized.
    try:
        frontend_value, safe_value = _read_safe_frontend_value(
            value,
            budget=value_budget,
        )
    except _ControlReadError as error:
        value_budget.opaque = True
        source_error = error.__cause__
        safe_value = _safe_value(
            {
                "unavailable": _type_name(
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
    return safe_value if can_show else None, value_budget, not can_show


def _read_safe_frontend_value(
    value: Any,
    *,
    budget: _ValueBudget,
) -> tuple[Any, Any]:
    try:
        frontend_value = value._value_frontend
        return frontend_value, _safe_value(frontend_value, budget=budget)
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


__all__ = ["ControlSource", "capture_control", "identify_control"]
