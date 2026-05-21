"""Public chart adapter namespace for Lens inspectors."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .inspectors.charts import (
    AltairChartAdapter,
    ChartAdapter,
    ChartAdapterFunction,
    ChartEntity,
    ChartInspector,
    ChartMetadata,
    ChartRegistry,
    FunctionChartAdapter,
    MatplotlibChartAdapter,
    PlotlyChartAdapter,
    VisualChartAdapter,
    chart_adapter,
    chart_part,
    default_chart_adapters,
    default_chart_registry,
)

Inspector = ChartInspector
Metadata = ChartMetadata
adapter = chart_adapter


class _PartNamespace:
    """Convenience chart part builders."""

    def axis(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "axis",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def mark(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "mark",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def legend(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "legend",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def annotation(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "annotation",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def plot_area(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "plot-area",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def title(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "title",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def trace(
        self,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            "trace",
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )

    def custom(
        self,
        kind: str,
        label: str,
        detail: str | None = None,
        *,
        id: str | None = None,
        channel: str | None = None,
        field: str | None = None,
        orientation: str | None = None,
        selector: str | None = None,
        datum: Mapping[str, Any] | None = None,
        context: Mapping[str, Any] | None = None,
        extensions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return chart_part(
            kind,
            label,
            detail,
            id=id,
            channel=channel,
            field=field,
            orientation=orientation,
            selector=selector,
            datum=datum,
            context=context,
            extensions=extensions,
        )


part = _PartNamespace()

__all__ = [
    "AltairChartAdapter",
    "ChartAdapter",
    "ChartAdapterFunction",
    "ChartEntity",
    "ChartInspector",
    "ChartMetadata",
    "ChartRegistry",
    "FunctionChartAdapter",
    "Inspector",
    "MatplotlibChartAdapter",
    "Metadata",
    "PlotlyChartAdapter",
    "VisualChartAdapter",
    "adapter",
    "chart_adapter",
    "chart_part",
    "default_chart_adapters",
    "default_chart_registry",
    "part",
]
