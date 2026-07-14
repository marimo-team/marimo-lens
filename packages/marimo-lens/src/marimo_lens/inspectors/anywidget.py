"""Inspector for raw anywidget instances."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import anywidget

from ._capabilities import capabilities, selection_policy
from ._core import LensEntity
from ._metadata import columns, safe_anywidget_state, shape


class AnyWidgetInspector:
    id = "anywidget"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        if not isinstance(value, anywidget.AnyWidget):
            return None
        state = safe_anywidget_state(value)
        value_columns = columns(value)
        return {
            "kind": "anywidget",
            "family": "interactive",
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
            "summary": f"{entity.name}: {type(value).__name__} with {len(state)} synced traits",
        }
