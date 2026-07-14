from __future__ import annotations

from marimo_lens.inspectors import ChartInspector, default_entity_registry
from marimo_lens.targets import collect_targets

from tests.support.graph_fixtures import cell, notebook_graph, sales_graph
from tests.support.sample_entities import CustomChart, CustomChartAdapter, FrameLike


def test_collect_targets_honors_include_and_exclude() -> None:
    targets = collect_targets(
        {"sales": FrameLike(), "threshold": 10, "note": "draft"},
        include=["sales", "threshold", "note"],
        exclude=["threshold"],
        graph=sales_graph(),
    )

    assert [target["variable"] for target in targets] == ["sales", "note"]


def test_collect_targets_filters_output_targets_by_include_and_exclude() -> None:
    graph = notebook_graph(
        cells=[
            cell("cell-sales", refs=("sales",), has_output_expression=True),
            cell("cell-orders", refs=("orders",), has_output_expression=True),
        ],
        definitions={"sales": ["cell-data"], "orders": ["cell-orders-data"]},
    )

    included = collect_targets(
        {"sales": FrameLike(), "orders": FrameLike()},
        include=["sales"],
        graph=graph,
    )
    excluded = collect_targets(
        {"sales": FrameLike(), "orders": FrameLike()},
        exclude=["orders"],
        graph=graph,
    )

    assert "output:cell-sales" in {target["id"] for target in included}
    assert "output:cell-orders" not in {target["id"] for target in included}
    assert "output:cell-orders" not in {target["id"] for target in excluded}


def test_target_display_cells_do_not_guess_from_code_previews() -> None:
    [target] = collect_targets({"sales": FrameLike()}, graph=sales_graph())

    assert target["cellId"] == "cell-data"
    assert target.get("displayCellIds", []) == []
    assert target["relatedCellIds"] == ["cell-view"]


def test_target_display_cells_come_from_runtime_output_refs() -> None:
    targets = collect_targets(
        {"sales": FrameLike()}, graph=sales_graph(display_sales=True)
    )
    target = next(target for target in targets if target["id"] == "var:sales")
    output = next(target for target in targets if target["id"] == "output:cell-view")

    assert target["displayCellIds"] == ["cell-view"]
    assert '[id="output-cell-view"]' in target["selectors"]
    assert output["kind"] == "output"
    assert output["cellId"] == "cell-view"
    assert output["displayCellIds"] == ["cell-view"]
    assert output["defs"] == ["view"]
    assert output["refs"] == ["sales"]
    assert output["outputRefs"] == ["sales"]
    assert output["selectionPolicy"]["prefer"] == ["display-cell", "selector"]


def test_collect_targets_adds_output_target_for_unnamed_rendered_expression() -> None:
    graph = notebook_graph(
        cells=[
            cell(
                "cell-shape",
                refs=("movies",),
                has_output_expression=True,
                code_preview="movies.shape",
            )
        ],
        definitions={"movies": ["cell-data"]},
    )

    targets = collect_targets({"movies": FrameLike()}, graph=graph)
    output = next(target for target in targets if target["id"] == "output:cell-shape")

    assert output["id"] == "output:cell-shape"
    assert output["kind"] == "output"
    assert output.get("variable", "") == ""
    assert output["refs"] == ["movies"]
    assert output.get("defs", []) == []
    assert output.get("outputType", "") == ""
    assert output["codePreview"] == "movies.shape"
    assert output["selectors"] == [
        '[id="output-cell-shape"]',
        '[id="cell-cell-shape"]',
        '[data-cell-id="cell-shape"]',
    ]


def test_expression_output_refs_link_single_referenced_variable_display() -> None:
    graph = notebook_graph(
        cells=[
            cell(
                "cell-data",
                defs=("movies",),
                code_preview="movies = pd.DataFrame(...)",
            ),
            cell(
                "cell-view",
                refs=("movies",),
                has_output_expression=True,
                code_preview="movies",
            ),
        ],
        definitions={"movies": ["cell-data"]},
        edges=[{"from": "cell-data", "to": "cell-view"}],
    )

    targets = collect_targets({"movies": FrameLike()}, graph=graph)
    target = next(target for target in targets if target["id"] == "var:movies")

    assert target["displayCellIds"] == ["cell-view"]
    assert '[id="output-cell-view"]' in target["selectors"]


def test_collect_targets_inspects_direct_chart_outputs() -> None:
    chart = CustomChart()
    graph = notebook_graph(
        cells=[
            cell(
                "cell-chart",
                refs=("movies",),
                output=chart,
                output_type="tests.support.sample_entities.CustomChart",
                code_preview="alt.Chart(movies).mark_bar()",
            )
        ],
        definitions={"movies": ["cell-data"]},
    )
    registry = default_entity_registry().with_inspectors(
        [ChartInspector(adapters=[CustomChartAdapter()])]
    )

    output = next(
        target
        for target in collect_targets(
            {"movies": FrameLike()},
            graph=graph,
            entity_registry=registry,
        )
        if target["id"] == "output:cell-chart"
    )

    assert output["kind"] == "output"
    assert output["entity"]["inspector"] == "chart"
    assert output["output"]["kind"] == "visualization"
    assert output["chart"]["library"] == "custom"
    assert output["capabilities"]["chartPart"] is True
    assert output["selectionPolicy"]["prefer"] == [
        "chart-part",
        "visual-surface",
        "display-cell",
        "selector",
    ]


def test_collect_targets_json_sanitizes_direct_output_inspector_metadata() -> None:
    class ObjectExtensionInspector:
        id = "object-extension"

        def inspect(self, entity):
            if entity.name != "output:cell-rich":
                return None
            return {
                "kind": "object",
                "summary": "rich output",
                "extensions": {"raw": object()},
            }

    graph = notebook_graph(
        cells=[cell("cell-rich", output=object(), output_type="builtins.object")],
        definitions={},
    )
    registry = default_entity_registry().with_inspectors([ObjectExtensionInspector()])

    output = next(
        target
        for target in collect_targets({}, graph=graph, entity_registry=registry)
        if target["id"] == "output:cell-rich"
    )

    assert output["extensions"]["raw"].startswith("<object object at ")


def test_target_related_cells_come_from_refs() -> None:
    [target] = collect_targets({"sales": FrameLike()}, graph=sales_graph())

    assert target["relatedCellIds"] == ["cell-view"]
    assert target["refs"] == ["pd"]


def test_collect_targets_filters_internal_values() -> None:
    targets = collect_targets(
        {
            "sales": FrameLike(),
            "_private": FrameLike(),
            "mo": object(),
            "helper": lambda value: value,
        },
        include=["sales", "_private", "mo", "helper"],
        graph=sales_graph(),
    )

    assert [target["variable"] for target in targets] == ["sales"]
