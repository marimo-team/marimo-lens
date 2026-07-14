"""Plotly chart adapter."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..._serialization import MAX_VALUE_ITEMS
from ._core import ChartEntity
from ._metadata import (
    axis_title,
    chart_library,
    chart_part,
    call_chart_method,
    dedupe_chart_parts,
)


class PlotlyChartAdapter:
    id = "plotly"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        value = chart.value
        if chart_library(value) != "plotly":
            return None
        return plotly_chart_metadata(value)


def plotly_chart_metadata(value: Any) -> dict[str, Any] | None:
    spec = call_chart_method(value, "to_plotly_json")
    if spec is None:
        return None
    return plotly_chart_metadata_from_spec(spec)


def plotly_chart_metadata_from_spec(
    spec: Mapping[str, Any],
    *,
    renderer: str | None = None,
) -> dict[str, Any]:
    data = spec.get("data", [])
    layout = spec.get("layout", {})
    parts: list[dict[str, Any]] = []
    if isinstance(data, Sequence):
        for index, trace in enumerate(data[:MAX_VALUE_ITEMS], start=1):
            if isinstance(trace, Mapping):
                trace_mapping: Mapping[Any, Any] = trace
                trace_type = str(trace_mapping.get("type") or "trace")
                name = str(trace_mapping.get("name") or f"{trace_type} {index}")
            else:
                trace_type = "trace"
                name = f"trace {index}"
            parts.append(chart_part("trace", name, trace_type))
    if isinstance(layout, Mapping):
        for key, axis in layout.items():
            key_text = str(key)
            if key_text.startswith(("xaxis", "yaxis")):
                label = "x axis" if key_text.startswith("xaxis") else "y axis"
                detail = axis_title(axis) or key_text
                parts.append(chart_part("axis", label, detail))
        if layout.get("showlegend", True) and data:
            parts.append(chart_part("legend", "legend"))
        title = axis_title(layout.get("title"))
        if title:
            parts.append(chart_part("title", title))
    metadata: dict[str, Any] = {
        "library": "plotly",
        "traceCount": len(data) if isinstance(data, Sequence) else 0,
        "parts": dedupe_chart_parts(parts),
    }
    if renderer:
        metadata["renderer"] = renderer
    return metadata
