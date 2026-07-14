"""Generic visual chart adapter."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._core import ChartEntity
from ._metadata import chart_library, chart_part


class VisualChartAdapter:
    id = "visual"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        library = chart_library(chart.value, is_svg_html=chart.is_svg_html)
        if library != "visual":
            return None
        return {
            "library": library,
            "parts": [chart_part("plot-area", "visual")],
        }
