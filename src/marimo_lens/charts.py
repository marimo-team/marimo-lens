"""Public chart adapter namespace for Lens inspectors."""

from __future__ import annotations

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
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("axis", label, detail, **metadata)

    def mark(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("mark", label, detail, **metadata)

    def legend(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("legend", label, detail, **metadata)

    def annotation(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("annotation", label, detail, **metadata)

    def plot_area(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("plot-area", label, detail, **metadata)

    def title(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("title", label, detail, **metadata)

    def trace(
        self,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part("trace", label, detail, **metadata)

    def custom(
        self,
        kind: str,
        label: str,
        detail: str | None = None,
        **metadata: Any,
    ) -> dict[str, Any]:
        return chart_part(kind, label, detail, **metadata)


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
