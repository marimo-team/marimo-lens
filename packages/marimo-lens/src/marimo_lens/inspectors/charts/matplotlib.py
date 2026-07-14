"""Matplotlib chart adapter."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..._serialization import MAX_VALUE_ITEMS
from ._core import ChartEntity
from ._metadata import (
    chart_library,
    chart_part,
    call_optional,
    dedupe_chart_parts,
)


class MatplotlibChartAdapter:
    id = "matplotlib"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        value = chart.value
        if chart_library(value) != "matplotlib":
            return None
        return matplotlib_chart_metadata(value)


def matplotlib_chart_metadata(value: Any) -> dict[str, Any]:
    figure = matplotlib_figure(value)
    axes = list(getattr(figure, "axes", []) or [])
    parts: list[dict[str, Any]] = []
    line_count = 0
    patch_count = 0
    collection_count = 0
    for index, axis in enumerate(axes[:MAX_VALUE_ITEMS], start=1):
        title = call_optional(axis, "get_title")
        xlabel = call_optional(axis, "get_xlabel")
        ylabel = call_optional(axis, "get_ylabel")
        parts.append(chart_part("plot-area", f"axes {index}", title))
        if xlabel:
            parts.append(chart_part("axis", "x axis", xlabel))
        if ylabel:
            parts.append(chart_part("axis", "y axis", ylabel))
        if call_optional(axis, "get_legend") is not None:
            parts.append(chart_part("legend", "legend", title))
        lines = list(getattr(axis, "lines", []) or [])
        patches = list(getattr(axis, "patches", []) or [])
        collections = list(getattr(axis, "collections", []) or [])
        line_count += len(lines)
        patch_count += len(patches)
        collection_count += len(collections)
    if line_count:
        parts.append(chart_part("mark", "lines", str(line_count)))
    if patch_count:
        parts.append(chart_part("mark", "patches", str(patch_count)))
    if collection_count:
        parts.append(chart_part("mark", "collections", str(collection_count)))
    return {
        "library": "matplotlib",
        "axesCount": len(axes),
        "parts": dedupe_chart_parts(parts),
    }


def matplotlib_figure(value: Any) -> Any:
    if hasattr(value, "axes"):
        return value
    return getattr(value, "figure", value)
