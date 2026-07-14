from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from marimo_lens.inspectors import (
    ChartEntity,
    ChartInspector,
    ChartMetadata,
    ChartRegistry,
    chart_adapter,
    chart_part,
)

from tests.support.sample_entities import (
    CustomChart,
    CustomChartAdapter,
    lens_entity,
)


class EmptyAdapter:
    id = "empty"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        return None


class ExplodingAdapter:
    id = "exploding"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        raise RuntimeError("adapter failed")


class BasicAdapter:
    id = "basic"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        return {
            "parts": [
                chart_part("axis", "x axis"),
                chart_part("axis", "x axis"),
            ]
        }


def test_chart_registry_uses_first_matching_adapter() -> None:
    registry = ChartRegistry((EmptyAdapter(), BasicAdapter()))

    metadata = registry.inspect(object())

    assert metadata is not None
    assert metadata["library"] == "basic"


def test_chart_registry_injects_library_and_dedupes_parts() -> None:
    metadata = ChartRegistry((BasicAdapter(),)).inspect(object())

    assert metadata is not None
    assert metadata["library"] == "basic"
    assert metadata["parts"] == [
        {"kind": "axis", "label": "x axis", "library": "basic"}
    ]


def test_chart_registry_strict_exception_behavior() -> None:
    metadata = ChartRegistry((ExplodingAdapter(), BasicAdapter())).inspect(object())

    assert metadata is not None
    assert metadata["library"] == "basic"

    with pytest.raises(RuntimeError, match="adapter failed"):
        ChartRegistry((ExplodingAdapter(),), strict=True).inspect(object())


def test_chart_adapter_decorator_accepts_value_and_context_functions() -> None:
    @chart_adapter(CustomChart, library="custom")
    def inspect_value(chart: CustomChart) -> ChartMetadata:
        assert isinstance(chart, CustomChart)
        return ChartMetadata(parts=[chart_part("axis", "decorated axis", "x")])

    @chart_adapter("contextual")
    def inspect_context(chart: ChartEntity) -> Mapping[str, Any]:
        assert isinstance(chart, ChartEntity)
        return {"parts": [chart_part("plot-area", "context")]}

    value_metadata = ChartRegistry((inspect_value,)).inspect(CustomChart())
    context_metadata = ChartRegistry((inspect_context,)).inspect(object())

    assert value_metadata is not None
    assert value_metadata["library"] == "custom"
    assert value_metadata["parts"][0]["label"] == "decorated axis"
    assert context_metadata is not None
    assert context_metadata["library"] == "contextual"


def test_chart_adapter_type_gating() -> None:
    @chart_adapter(CustomChart, library="custom")
    def inspect_value(_chart: CustomChart) -> ChartMetadata:
        return ChartMetadata(parts=[chart_part("axis", "x axis")])

    assert ChartRegistry((inspect_value,)).inspect(object()) is None


def test_chart_inspector_custom_adapters_prepend_default_adapters() -> None:
    metadata = ChartInspector(adapters=[CustomChartAdapter()]).inspect(
        lens_entity("chart", CustomChart())
    )

    assert metadata is not None
    assert metadata["kind"] == "visualization"
    assert metadata["chart"]["library"] == "custom"
    assert metadata["chart"]["parts"][0]["library"] == "custom"


def test_chart_inspector_can_disable_builtin_adapters() -> None:
    import altair as alt

    chart = (
        alt.Chart({"values": [{"x": "Q1", "y": 1}]})
        .mark_bar()
        .encode(
            x="x:N",
            y="y:Q",
        )
    )

    assert (
        ChartInspector(use_defaults=False).inspect(lens_entity("chart", chart)) is None
    )
