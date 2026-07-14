from __future__ import annotations

from types import SimpleNamespace

import pytest

from marimo_lens.inspectors import MarimoComponentInspector

from tests.support.sample_entities import lens_entity, sales_frame


def test_marimo_table_uses_dom_columnar_semantics_from_field_types() -> None:
    import marimo as mo

    table = mo.ui.table(sales_frame())
    metadata = MarimoComponentInspector().inspect(lens_entity("sales_table", table))

    assert metadata is not None
    assert metadata["kind"] == "table"
    assert metadata["family"] == "tabular"
    assert metadata["component"] == "marimo-table"
    assert metadata["shape"] == {"rows": 2, "columns": 3}
    assert metadata["columns"] == [
        {"name": "region", "dtype": "str"},
        {"name": "revenue", "dtype": "int64"},
        {"name": "margin", "dtype": "float64"},
    ]
    assert metadata["capabilities"]["columnarDom"] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == [
        "columnar-dom",
        "interactive",
        "selector",
    ]


@pytest.mark.parametrize(
    ("factory_name", "component_name", "surface", "capability"),
    [
        (
            "dataframe",
            "marimo-dataframe",
            "columnar-dom",
            "columnarDom",
        ),
        (
            "data_editor",
            "marimo-data-editor",
            "columnar-grid",
            "columnarGrid",
        ),
    ],
)
def test_marimo_dataframe_components_distinguish_dom_and_grid_surfaces(
    factory_name: str,
    component_name: str,
    surface: str,
    capability: str,
) -> None:
    import marimo as mo

    component = getattr(mo.ui, factory_name)(sales_frame())
    metadata = MarimoComponentInspector().inspect(lens_entity("sales_grid", component))

    assert metadata is not None
    assert metadata["kind"] == "dataframe"
    assert metadata["family"] == "tabular"
    assert metadata["component"] == component_name
    assert metadata["shape"] == {"rows": 2, "columns": 3}
    assert metadata["columns"][0] == {"name": "region", "dtype": "str"}
    assert metadata["capabilities"][capability] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == [
        surface,
        "interactive",
        "selector",
    ]


def test_marimo_data_explorer_is_visual_and_columnar() -> None:
    import marimo as mo

    explorer = mo.ui.data_explorer(sales_frame())
    metadata = MarimoComponentInspector().inspect(lens_entity("explorer", explorer))

    assert metadata is not None
    assert metadata["kind"] == "visualization"
    assert metadata["family"] == "data-explorer"
    assert metadata["component"] == "marimo-data-explorer"
    assert metadata["shape"] == {"rows": 2, "columns": 3}
    assert metadata["capabilities"]["columnarGrid"] is True
    assert metadata["capabilities"]["visualSurface"] is True
    assert metadata["capabilities"]["chartPart"] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["chart"]["library"] == "marimo-data-explorer"
    assert metadata["selectionPolicy"]["prefer"] == [
        "chart-part",
        "columnar-grid",
        "visual-surface",
        "interactive",
        "selector",
    ]


def test_marimo_altair_chart_preserves_vega_fields() -> None:
    import altair as alt
    import marimo as mo

    chart = (
        alt.Chart(sales_frame())
        .mark_bar()
        .encode(x="region:N", y="revenue:Q", color="margin:Q")
    )
    component = mo.ui.altair_chart(chart)
    metadata = MarimoComponentInspector().inspect(lens_entity("sales_chart", component))

    assert metadata is not None
    parts = {(part["kind"], part["label"]) for part in metadata["chart"]["parts"]}
    assert metadata["kind"] == "visualization"
    assert metadata["family"] == "chart"
    assert metadata["component"] == "marimo-vega"
    assert metadata["chart"]["library"] == "vega"
    assert metadata["capabilities"]["columnarDom"] is True
    assert metadata["capabilities"]["visualSurface"] is True
    assert metadata["capabilities"]["chartPart"] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == [
        "columnar-dom",
        "chart-part",
        "visual-surface",
        "interactive",
        "selector",
    ]
    assert ("mark", "bar") in parts
    assert ("axis", "x axis") in parts
    assert ("axis", "y axis") in parts
    assert any(kind == "legend" for kind, _label in parts)
    assert metadata["columns"] == [
        {"name": "region", "dtype": "str"},
        {"name": "revenue", "dtype": "int64"},
        {"name": "margin", "dtype": "float64"},
    ]


def test_marimo_composed_altair_chart_preserves_child_fields_and_parts() -> None:
    import altair as alt
    import marimo as mo

    base = alt.Chart(sales_frame()).encode(x="region:N", y="revenue:Q")
    component = mo.ui.altair_chart(base.mark_bar() + base.mark_line())
    metadata = MarimoComponentInspector().inspect(lens_entity("sales_chart", component))

    assert metadata is not None
    parts = {(part["kind"], part["label"]) for part in metadata["chart"]["parts"]}
    assert "mark" not in metadata["chart"]
    assert ("mark", "bar") in parts
    assert ("mark", "line") in parts
    assert ("axis", "x axis") in parts
    assert ("axis", "y axis") in parts
    assert [column["name"] for column in metadata["columns"][:2]] == [
        "region",
        "revenue",
    ]


@pytest.mark.parametrize(
    ("component_name", "library", "renderer"),
    [
        ("marimo-plotly", "plotly", "html"),
        ("marimo-matplotlib", "matplotlib", "html"),
        ("marimo-mpl-interactive", "matplotlib", "interactive"),
        ("marimo-panel", "panel", "iframe"),
    ],
)
def test_marimo_chart_component_names_preserve_visual_capability(
    monkeypatch: pytest.MonkeyPatch,
    component_name: str,
    library: str,
    renderer: str,
) -> None:
    import marimo_lens.inspectors.marimo_components as marimo_components

    monkeypatch.setattr(marimo_components, "is_marimo_ui_element", lambda value: True)
    component = SimpleNamespace(
        _args=SimpleNamespace(component_name=component_name, label=None),
        _component_args={"figure": {"kind": library}},
        value={},
    )
    metadata = MarimoComponentInspector().inspect(lens_entity("chart", component))

    assert metadata is not None
    assert metadata["kind"] == "visualization"
    assert metadata["family"] == "chart"
    assert metadata["component"] == component_name
    assert metadata["chart"]["library"] == library
    assert metadata["chart"]["renderer"] == renderer
    assert metadata["capabilities"]["visualSurface"] is True
    assert metadata["capabilities"]["chartPart"] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == [
        "chart-part",
        "visual-surface",
        "interactive",
        "selector",
    ]


def test_marimo_plotly_component_preserves_figure_parts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens.inspectors.marimo_components as marimo_components

    monkeypatch.setattr(marimo_components, "is_marimo_ui_element", lambda value: True)
    component = SimpleNamespace(
        _args=SimpleNamespace(component_name="marimo-plotly", label=None),
        _component_args={
            "figure": {
                "data": [{"type": "bar", "name": "Revenue"}],
                "layout": {
                    "xaxis": {"title": {"text": "Quarter"}},
                    "yaxis": {"title": {"text": "Revenue"}},
                    "title": {"text": "Sales"},
                },
            }
        },
        value={},
    )

    metadata = MarimoComponentInspector().inspect(
        lens_entity("plotly_chart", component)
    )

    assert metadata is not None
    parts = {
        (part["kind"], part["label"], part.get("detail"))
        for part in metadata["chart"]["parts"]
    }
    assert metadata["chart"]["library"] == "plotly"
    assert metadata["chart"]["renderer"] == "html"
    assert ("trace", "Revenue", "bar") in parts
    assert ("axis", "x axis", "Quarter") in parts
    assert ("axis", "y axis", "Revenue") in parts
    assert ("title", "Sales", None) in parts


def test_marimo_layout_components_use_layout_kind() -> None:
    import marimo as mo

    tabs = mo.ui.tabs({"Summary": "ok", "Details": "more"})
    metadata = MarimoComponentInspector().inspect(lens_entity("tabs", tabs))

    assert metadata is not None
    assert metadata["kind"] == "layout"
    assert metadata["component"] == "marimo-tabs"
    assert metadata["family"] == "layout"
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == ["interactive", "selector"]


def test_component_args_take_priority_for_columns_and_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens.inspectors.marimo_components as marimo_components

    monkeypatch.setattr(marimo_components, "is_marimo_ui_element", lambda value: True)
    component = SimpleNamespace(
        _args=SimpleNamespace(component_name="marimo-dataframe", label=None),
        _component_args={
            "columns": [("from_args", "str")],
            "total-rows": 42,
            "total-columns": 1,
        },
        _data=sales_frame(),
        value=sales_frame(),
    )

    metadata = MarimoComponentInspector().inspect(lens_entity("grid", component))

    assert metadata is not None
    assert metadata["columns"] == [{"name": "from_args", "dtype": "str"}]
    assert metadata["shape"] == {"rows": 42, "columns": 1}
