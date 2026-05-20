from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import anywidget


def runtime_context() -> tuple[Any | None, str | None]:
    """Return the live marimo runtime context, if this code runs in marimo."""

    try:
        from marimo._runtime.context import get_context
        from marimo._runtime.context.types import ContextNotInitializedError
    except Exception:
        return None, "marimo runtime not importable"

    try:
        return get_context(), None
    except ContextNotInitializedError:
        return None, "not running in a marimo kernel"
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def runtime_globals(ctx: Any | None) -> dict[str, Any]:
    if ctx is None:
        return {}
    try:
        runtime_globals_value = getattr(ctx, "globals", {}) or {}
    except Exception:
        return {}
    return dict(runtime_globals_value)


def is_marimo_ui_element(value: Any) -> bool:
    try:
        from marimo._plugins.ui._core.ui_element import UIElement
    except Exception:
        return False

    return isinstance(value, UIElement)


@dataclass(frozen=True)
class MarimoComponent:
    """Stable Lens-facing view over marimo UIElement private attributes."""

    name: str
    args: Mapping[str, Any]
    label: str
    element_id: str
    widget: Any | None
    data: Any | None


def marimo_component(value: Any) -> MarimoComponent:
    """Return marimo UI metadata behind one adapter boundary.

    marimo does not yet expose all component metadata through a public API.
    Keeping the private attribute reads here makes version drift visible and
    avoids scattering ``_args`` / ``_component_args`` access across inspectors.
    """

    args = getattr(value, "_args", None)
    name = str(
        getattr(args, "component_name", None) or getattr(value, "_name", "") or ""
    )
    label = str(getattr(args, "label", None) or "")
    component_args = dict(getattr(value, "_component_args", {}) or {})
    return MarimoComponent(
        name=name,
        args=component_args,
        label=label,
        element_id=str(getattr(value, "_id", "") or ""),
        widget=getattr(value, "widget", None),
        data=getattr(value, "_data", None),
    )


def anywidget_state(widget: anywidget.AnyWidget) -> Mapping[str, Any]:
    from marimo._plugins.ui._impl.from_anywidget import get_anywidget_state

    return get_anywidget_state(widget)
