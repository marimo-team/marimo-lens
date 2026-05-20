from __future__ import annotations

from marimo_lens.inspectors import ChartInspector, default_entity_registry
from marimo_lens.targets import collect_targets

from tests.support.sample_entities import CustomChart, CustomChartAdapter, FrameLike


def _graph(*, display_sales: bool = False) -> dict[str, object]:
    return {
        "available": True,
        "cells": [
            {
                "id": "cell-data",
                "defs": ["sales"],
                "refs": ["pd"],
                "outputRefs": [],
                "codePreview": "sales = pd.DataFrame(...)",
            },
            {
                "id": "cell-view",
                "defs": ["view"],
                "refs": ["sales"],
                "outputRefs": ["sales"] if display_sales else [],
                "outputType": "tests.support.sample_entities.FrameLike"
                if display_sales
                else "",
                "codePreview": "view = mo.ui.table(sales)",
            },
        ],
        "definitions": {"sales": ["cell-data"], "view": ["cell-view"]},
        "edges": [{"from": "cell-data", "to": "cell-view"}],
        "globals": [],
        "controls": {},
    }


def test_collect_targets_honors_include_and_exclude() -> None:
    targets = collect_targets(
        {"sales": FrameLike(), "threshold": 10, "note": "draft"},
        include=["sales", "threshold", "note"],
        exclude=["threshold"],
        graph=_graph(),
    )

    assert [target["variable"] for target in targets] == ["sales", "note"]


def test_target_display_cells_do_not_guess_from_code_previews() -> None:
    [target] = collect_targets({"sales": FrameLike()}, graph=_graph())

    assert target["cellId"] == "cell-data"
    assert target["displayCellIds"] == []
    assert target["relatedCellIds"] == ["cell-view"]


def test_target_display_cells_come_from_runtime_output_refs() -> None:
    targets = collect_targets({"sales": FrameLike()}, graph=_graph(display_sales=True))
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
    graph = {
        "available": True,
        "cells": [
            {
                "id": "cell-shape",
                "defs": [],
                "refs": ["movies"],
                "outputRefs": [],
                "outputType": "",
                "hasOutputExpression": True,
                "codePreview": "movies.shape",
            }
        ],
        "definitions": {"movies": ["cell-data"]},
        "edges": [],
        "globals": [],
        "controls": {},
    }

    targets = collect_targets({"movies": FrameLike()}, graph=graph)
    output = next(target for target in targets if target["id"] == "output:cell-shape")

    assert output["id"] == "output:cell-shape"
    assert output["kind"] == "output"
    assert output.get("variable", "") == ""
    assert output["refs"] == ["movies"]
    assert output["defs"] == []
    assert output["outputType"] == ""
    assert output["codePreview"] == "movies.shape"
    assert output["selectors"] == [
        '[id="output-cell-shape"]',
        '[id="cell-cell-shape"]',
        '[data-cell-id="cell-shape"]',
    ]


def test_collect_targets_inspects_direct_chart_outputs() -> None:
    chart = CustomChart()
    graph = {
        "available": True,
        "cells": [
            {
                "id": "cell-chart",
                "defs": [],
                "refs": ["movies"],
                "output": chart,
                "outputRefs": [],
                "outputType": "tests.support.sample_entities.CustomChart",
                "codePreview": "alt.Chart(movies).mark_bar()",
            }
        ],
        "definitions": {"movies": ["cell-data"]},
        "edges": [],
        "globals": [],
        "controls": {},
    }
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
        "chart-unit",
        "visual-surface",
        "display-cell",
        "selector",
    ]


def test_target_related_cells_come_from_refs() -> None:
    [target] = collect_targets({"sales": FrameLike()}, graph=_graph())

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
        graph=_graph(),
    )

    assert [target["variable"] for target in targets] == ["sales"]
