"""Inspector for chart and visualization objects."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .._capabilities import capabilities, selection_policy
from .._core import LensEntity
from .._metadata import columns, is_svg_html, shape, visualization_summary
from ._core import ChartAdapter, ChartRegistry, default_chart_adapters


class ChartInspector:
    """Inspect Python visualization objects through chart adapters."""

    id = "chart"

    def __init__(
        self,
        *,
        registry: ChartRegistry | None = None,
        adapters: Sequence[ChartAdapter] | None = None,
        use_defaults: bool = True,
    ) -> None:
        if registry is not None and adapters is not None:
            message = "Pass either registry or adapters, not both"
            raise ValueError(message)
        if registry is not None:
            self.registry = registry
            return
        ordered = tuple(adapters or ())
        if use_defaults:
            ordered = (*ordered, *default_chart_adapters())
        self.registry = ChartRegistry(ordered)

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        chart = self.registry.inspect(value, is_svg_html=is_svg_html(value))
        if chart is None:
            return None
        value_columns = columns(value)
        return {
            "kind": "visualization",
            "family": "chart",
            "shape": shape(value),
            "columns": value_columns,
            "chart": chart,
            "capabilities": capabilities(
                columnar_dom=bool(value_columns),
                visual_surface=True,
                chart_part=True,
            ),
            "selectionPolicy": selection_policy(
                "columnar-dom" if value_columns else "",
                "chart-part",
                "visual-surface",
            ),
            "summary": visualization_summary(entity.name, value_columns),
        }
