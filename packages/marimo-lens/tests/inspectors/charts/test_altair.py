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


def test_altair_adapter_generates_title_and_row_column_facet_parts() -> None:
    import altair as alt

    chart = (
        alt.Chart(
            alt.Data(
                values=[
                    {
                        "site": "Crookston",
                        "variety": "Manchuria",
                        "year_label": "1931",
                        "yield_amount": 27,
                    },
                    {
                        "site": "Crookston",
                        "variety": "Velvet",
                        "year_label": "1932",
                        "yield_amount": 31,
                    },
                    {
                        "site": "Morris",
                        "variety": "Manchuria",
                        "year_label": "1931",
                        "yield_amount": 29,
                    },
                ]
            )
        )
        .mark_bar()
        .encode(x="year_label:N", y="sum(yield_amount):Q", color="variety:N")
        .facet(column="site:N", row="variety")
        .properties(title="Faceted site yield")
    )
    metadata = AltairChartAdapter().inspect(ChartEntity(chart))

    assert metadata is not None
    parts = metadata["parts"]
    assert ("title", "Faceted site yield") in {
        (part["kind"], part["label"]) for part in parts
    }
    column_facet = next(
        part
        for part in parts
        if part["kind"] == "facet" and part.get("channel") == "column"
    )
    row_facet = next(
        part
        for part in parts
        if part["kind"] == "facet" and part.get("channel") == "row"
    )
    assert column_facet["field"] == "site"
    assert column_facet["context"] == {
        "values": ["Crookston", "Morris"],
        "count": 2,
    }
    assert row_facet["field"] == "variety"
    assert row_facet["context"] == {
        "values": ["Manchuria", "Velvet"],
        "count": 2,
    }


def test_altair_adapter_treats_row_column_encodings_as_facets() -> None:
    import altair as alt
    import polars as pl

    chart = (
        alt.Chart(
            pl.DataFrame(
                {
                    "Downloads_Xplore": [2605, 777, 1200],
                    "PubsCited_CrossRef": [11, 3, 5],
                    "PaperType": ["C", "J", "M"],
                    "Conference": ["InfoVis", "SciVis", "VAST"],
                }
            )
        )
        .mark_point()
        .encode(
            x="Downloads_Xplore",
            y="PubsCited_CrossRef",
            column="PaperType",
            row="Conference",
        )
        .properties(width=150, height=150)
    )

    metadata = AltairChartAdapter().inspect(ChartEntity(chart))

    assert metadata is not None
    facets = {
        part["channel"]: part for part in metadata["parts"] if part["kind"] == "facet"
    }
    assert facets["column"] == {
        "kind": "facet",
        "label": "column facet",
        "detail": "PaperType",
        "channel": "column",
        "field": "PaperType",
        "orientation": "column",
        "context": {"values": ["C", "J", "M"], "count": 3},
    }
    assert facets["row"] == {
        "kind": "facet",
        "label": "row facet",
        "detail": "Conference",
        "channel": "row",
        "field": "Conference",
        "orientation": "row",
        "context": {"values": ["InfoVis", "SciVis", "VAST"], "count": 3},
    }
    assert not any(
        part["kind"] == "annotation"
        and part.get("detail") in {"PaperType", "Conference"}
        for part in metadata["parts"]
    )


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


def test_altair_adapter_omits_null_mark_for_composed_specs() -> None:
    import altair as alt

    chart = alt.layer(
        alt.Chart({"values": [{"x": "Q1", "y": 1}]})
        .mark_bar()
        .encode(x="x:N", y="y:Q"),
        alt.Chart({"values": [{"x": "Q1", "y": 1}]})
        .mark_line()
        .encode(x="x:N", y="y:Q"),
    )
    metadata = AltairChartAdapter().inspect(ChartEntity(chart))

    assert metadata is not None
    assert "mark" not in metadata
    parts = {(part["kind"], part["label"]) for part in metadata["parts"]}
    assert ("mark", "bar") in parts
    assert ("mark", "line") in parts
    assert ("axis", "x axis") in parts
    assert ("axis", "y axis") in parts


def test_altair_adapter_retries_without_validation_when_default_to_dict_fails() -> None:
    class ChartWithInvalidValidatedSpec:
        __module__ = "altair.vegalite.v6.api"

        def to_dict(self, *, validate: bool = True) -> dict[str, object]:
            if validate:
                raise ValueError("validated spec rejected runtime data transformer")
            return {
                "mark": {"type": "bar"},
                "encoding": {
                    "x": {"field": "quarter"},
                    "y": {"field": "revenue"},
                },
            }

    metadata = AltairChartAdapter().inspect(
        ChartEntity(ChartWithInvalidValidatedSpec())
    )

    assert metadata is not None
    assert metadata["library"] == "altair"
    assert ("mark", "bar") in {
        (part["kind"], part["label"]) for part in metadata["parts"]
    }


def test_altair_adapter_ignores_charts_when_spec_cannot_be_read() -> None:
    class BrokenAltairChart:
        __module__ = "altair.vegalite.v6.api"

        def to_dict(self, *, validate: bool = True) -> dict[str, object]:
            del validate
            raise RuntimeError("broken chart")

    assert AltairChartAdapter().inspect(ChartEntity(BrokenAltairChart())) is None


def test_altair_adapter_exposes_tooltip_and_facet_parts() -> None:
    class TooltipFacetChart:
        __module__ = "altair.vegalite.v6.api"

        def to_dict(self, *, validate: bool = True) -> dict[str, object]:
            del validate
            return {
                "facet": {"field": "region"},
                "spec": {
                    "mark": "bar",
                    "encoding": {
                        "x": {"field": "quarter"},
                        "tooltip": [
                            {"field": "revenue"},
                            {"field": "margin"},
                        ],
                    },
                },
            }

    metadata = AltairChartAdapter().inspect(ChartEntity(TooltipFacetChart()))

    assert metadata is not None
    parts = {
        (part["kind"], part["label"], part.get("detail")) for part in metadata["parts"]
    }
    assert ("facet", "facet", "region") in parts
    assert ("axis", "x axis", "quarter") in parts
    assert ("annotation", "tooltip", "revenue") in parts
    assert ("annotation", "tooltip", "margin") in parts


def test_altair_adapter_resolves_repeat_encoding_fields() -> None:
    class RepeatedChart:
        __module__ = "altair.vegalite.v6.api"

        def to_dict(self, *, validate: bool = True) -> dict[str, object]:
            del validate
            return {
                "repeat": {"column": ["revenue", "margin"]},
                "spec": {
                    "mark": "bar",
                    "encoding": {
                        "x": {"field": "quarter"},
                        "y": {"field": {"repeat": "column"}},
                    },
                },
            }

    metadata = AltairChartAdapter().inspect(ChartEntity(RepeatedChart()))

    assert metadata is not None
    axes = {
        part["label"]: part.get("detail")
        for part in metadata["parts"]
        if part["kind"] == "axis"
    }
    assert axes == {
        "x axis": "quarter",
        "y axis": "revenue, margin",
    }
