from __future__ import annotations

from typing import Any


def cell(
    id: str,
    *,
    defs: tuple[str, ...] = (),
    refs: tuple[str, ...] = (),
    output_refs: tuple[str, ...] = (),
    output_type: str = "",
    code_preview: str = "",
    output: Any = None,
    has_output_expression: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": id,
        "defs": list(defs),
        "refs": list(refs),
        "outputRefs": list(output_refs),
        "codePreview": code_preview,
    }
    if output is not None:
        payload["output"] = output
    if output_type or has_output_expression:
        payload["outputType"] = output_type
    if has_output_expression:
        payload["hasOutputExpression"] = True
    return payload


def notebook_graph(
    *,
    cells: list[dict[str, Any]],
    definitions: dict[str, list[str]],
    edges: list[dict[str, str]] | None = None,
    globals: list[dict[str, Any]] | None = None,
    controls: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "available": True,
        "cells": cells,
        "definitions": definitions,
        "edges": edges or [],
        "globals": globals or [],
        "controls": controls or {},
    }


def sales_graph(*, display_sales: bool = False) -> dict[str, Any]:
    return notebook_graph(
        cells=[
            cell(
                "cell-data",
                defs=("sales",),
                refs=("pd",),
                code_preview="sales = pd.DataFrame(...)",
            ),
            cell(
                "cell-view",
                defs=("view",),
                refs=("sales",),
                output_refs=("sales",) if display_sales else (),
                output_type="tests.support.sample_entities.FrameLike"
                if display_sales
                else "",
                code_preview="view = mo.ui.table(sales)",
            ),
        ],
        definitions={"sales": ["cell-data"], "view": ["cell-view"]},
        edges=[{"from": "cell-data", "to": "cell-view"}],
    )
