"""Altair chart adapter."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..._serialization import safe_value
from ._core import ChartEntity
from ._metadata import (
    chart_library,
    chart_part,
    call_chart_method,
    dedupe_chart_parts,
    field_label,
)


class AltairChartAdapter:
    id = "altair"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        value = chart.value
        if chart_library(value) != "altair":
            return None
        return altair_chart_metadata(value)


def altair_chart_metadata(value: Any) -> dict[str, Any]:
    spec = call_chart_method(value, "to_dict")
    encoding = spec.get("encoding", {}) if isinstance(spec, Mapping) else {}
    parts = [chart_part("mark", altair_mark_label(spec.get("mark")))]
    if isinstance(encoding, Mapping):
        for channel, channel_spec in encoding.items():
            field = field_label(channel_spec)
            channel_name = str(channel)
            if channel_name in {"x", "x2", "y", "y2"}:
                label = f"{channel_name[0]} axis"
                detail = field or channel_name
                parts.append(chart_part("axis", label, detail))
            elif channel_name in {"color", "fill", "shape", "size", "stroke"}:
                detail = field or channel_name
                parts.append(chart_part("legend", f"{channel_name} legend", detail))
            elif field:
                parts.append(chart_part("annotation", channel_name, field))
    return {
        "library": "altair",
        "mark": safe_value(spec.get("mark") if isinstance(spec, Mapping) else None),
        "encoding": safe_value(encoding),
        "parts": dedupe_chart_parts(parts),
    }


def altair_mark_label(mark: Any) -> str:
    if isinstance(mark, Mapping):
        return str(mark.get("type") or "mark")
    return str(mark or "mark")
