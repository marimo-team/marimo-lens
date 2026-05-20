from __future__ import annotations

from marimo_lens.inspectors import ChartEntity, ChartInspector
from marimo_lens.inspectors.charts.altair import AltairChartAdapter

from tests.support.sample_entities import lens_entity


def test_altair_adapter_generates_mark_axes_and_legend_parts() -> None:
    import altair as alt

    chart = (
        alt.Chart(
            {
                "values": [
                    {"quarter": "Q1", "region": "North", "revenue": 142},
                    {"quarter": "Q2", "region": "South", "revenue": 117},
                ]
            }
        )
        .mark_bar()
        .encode(x="quarter:N", y="revenue:Q", color="region:N")
    )
    metadata = AltairChartAdapter().inspect(ChartEntity(chart))

    assert metadata is not None
    parts = {(part["kind"], part["label"]) for part in metadata["parts"]}
    assert metadata["library"] == "altair"
    assert metadata["mark"] == {"type": "bar"}
    assert ("mark", "bar") in parts
    assert ("axis", "x axis") in parts
    assert ("axis", "y axis") in parts
    assert any(kind == "legend" for kind, _label in parts)


def test_altair_chart_inspector_exposes_visual_target_metadata() -> None:
    import altair as alt

    chart = (
        alt.Chart({"values": [{"x": "Q1", "y": 1}]}).mark_bar().encode(x="x:N", y="y:Q")
    )
    metadata = ChartInspector().inspect(lens_entity("chart", chart))

    assert metadata is not None
    assert metadata["kind"] == "visualization"
    assert metadata["chart"]["library"] == "altair"
    assert metadata["capabilities"]["visualSurface"] is True
    assert {part["library"] for part in metadata["chart"]["parts"]} == {"altair"}
