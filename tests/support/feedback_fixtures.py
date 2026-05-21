from __future__ import annotations

from copy import deepcopy
from typing import Any


def table_annotation(**overrides: Any) -> dict[str, Any]:
    selection = table_semantic_selection()
    annotation = {
        "id": "a1",
        "targetId": "var:sales",
        "targetLabel": "sales",
        "variable": "sales",
        "kind": "dataframe",
        "column": "revenue",
        "columnDtype": "int64",
        "cellId": "cell-data",
        "displayCellId": "cell-view",
        "comment": "Sort the table by revenue descending.",
        "element": "td",
        "elementPath": "table > tbody > tr:first-child > td:nth-child(2)",
        "documentX": 120,
        "documentY": 240,
        "boundingBox": {"x": 100, "y": 220, "width": 80, "height": 24},
        "semanticSelection": selection,
        "context": {"semanticSelection": context_semantic_selection(selection)},
        "createdAt": "2026-05-19T00:00:00+00:00",
    }
    annotation.update(deepcopy(overrides))
    return annotation


def chart_annotation(chart_part: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    selection = semantic_selection(
        id="chart:axis:x-axis",
        target_id="var:chart",
        kind=str(chart_part["kind"]),
        granularity="group",
        label=str(chart_part["label"]),
        data={"chartPart": chart_part},
        highlight_kind="element",
    )
    annotation = table_annotation(
        id="a1",
        targetId="var:chart",
        targetLabel="chart",
        variable="chart",
        kind="visualization",
        column=None,
        columnDtype=None,
        cellId=None,
        displayCellId=None,
        chartPart=chart_part,
        comment="Check the x-axis labels.",
        element="g.role-axis",
        elementPath="svg > g.role-axis",
        documentX=1,
        documentY=2,
        boundingBox={"x": 1, "y": 2, "width": 3, "height": 4},
        semanticSelection=selection,
        context={"semanticSelection": selection},
    )
    annotation.update(deepcopy(overrides))
    return annotation


def table_semantic_selection(**overrides: Any) -> dict[str, Any]:
    selection = semantic_selection(
        id="col:revenue",
        target_id="var:sales",
        kind="column",
        granularity="group",
        label="revenue",
        parent_id="var:sales",
        data={
            "column": "revenue",
            "columnDtype": "int64",
            "hitKind": "body-cell",
        },
        evidence=[
            {
                "kind": "table-hit",
                "hitKind": "body-cell",
                "column": "revenue",
            }
        ],
        highlight_kind="elements",
        highlight_extra={
            "strategy": "table-column",
            "boundingBox": {"x": 100, "y": 220, "width": 80, "height": 24},
        },
        anchor_data={
            "hitKind": "body-cell",
            "column": "revenue",
        },
    )
    selection.update(deepcopy(overrides))
    return selection


def semantic_selection(
    *,
    id: str,
    target_id: str,
    kind: str,
    granularity: str,
    label: str,
    data: dict[str, Any] | None = None,
    evidence: list[dict[str, Any]] | None = None,
    highlight_kind: str = "element",
    highlight_extra: dict[str, Any] | None = None,
    anchor_data: dict[str, Any] | None = None,
    parent_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "targetId": target_id,
        "kind": kind,
        "granularity": granularity,
        "label": label,
        **({"parentId": parent_id} if parent_id else {}),
        "data": data or {},
        "evidence": evidence or [],
        "highlight": {"kind": highlight_kind, **(highlight_extra or {})},
        "anchor": {"data": anchor_data or {}},
    }


def context_semantic_selection(selection: dict[str, Any]) -> dict[str, Any]:
    data = selection.get("data", {})
    return {
        "id": selection["id"],
        "targetId": selection["targetId"],
        "kind": selection["kind"],
        "granularity": selection["granularity"],
        "label": selection["label"],
        "data": {"column": data["column"]} if data.get("column") else dict(data),
        "evidence": [],
        "highlight": {"kind": selection["highlight"]["kind"]},
        "anchor": {},
    }
