"""Altair chart adapter."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..._serialization import safe_value
from ._core import ChartEntity
from ._metadata import (
    chart_library,
    chart_spec_parts,
    call_chart_method,
    dedupe_chart_parts,
)


class AltairChartAdapter:
    id = "altair"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        value = chart.value
        if chart_library(value) != "altair":
            return None
        return altair_chart_metadata(value)


def altair_chart_metadata(value: Any) -> dict[str, Any] | None:
    spec = call_chart_method(value, "to_dict")
    if spec is None:
        return None
    encoding = spec.get("encoding", {}) if isinstance(spec, Mapping) else {}
    mark = spec.get("mark") if isinstance(spec, Mapping) else None
    parts = chart_spec_parts(spec)
    metadata: dict[str, Any] = {
        "library": "altair",
        "encoding": safe_value(encoding),
        "parts": dedupe_chart_parts(parts),
    }
    if mark is not None:
        metadata["mark"] = safe_value(mark)
    return metadata
