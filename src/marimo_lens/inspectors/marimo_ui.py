"""Inspector for marimo UI elements."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .._marimo_runtime import is_marimo_ui_element, marimo_component
from ._capabilities import capabilities, selection_policy
from ._core import LensEntity
from ._metadata import (
    columns,
    control_summary,
    shape,
)


class MarimoUiInspector:
    id = "marimo-ui"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        if not is_marimo_ui_element(value):
            return None
        component = marimo_component(value)
        widget = component.widget
        name = component.name
        args = component.args
        label = component.label
        value_columns = columns(value)
        return {
            "kind": "anywidget" if widget is not None else "ui",
            "family": "interactive",
            "component": name,
            "componentMetadata": dict(args),
            "shape": shape(value),
            "columns": value_columns,
            "capabilities": capabilities(
                columnar_dom=bool(value_columns),
                interactive=True,
            ),
            "selectionPolicy": selection_policy(
                "columnar-dom" if value_columns else "",
                "interactive",
            ),
            "summary": control_summary(
                entity.name,
                value,
                name,
                args,
                label=label,
            ),
        }
