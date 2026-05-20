from __future__ import annotations

import json
from typing import Any

import pytest

from marimo_lens import Lens
from marimo_lens import context, targets
from marimo_lens._pair_feedback import (
    build_pair_feedback,
    render_markdown,
    render_pair_prompt,
)

from tests.support.sample_entities import FrameLike
from tests.support.runtime_contexts import _install_context, _runtime_context


def _annotation(**overrides: Any) -> dict[str, Any]:
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
        "intent": "fix",
        "severity": "blocking",
        "element": "td",
        "elementPath": "table > tbody > tr:first-child > td:nth-child(2)",
        "documentX": 120,
        "documentY": 240,
        "boundingBox": {"x": 100, "y": 220, "width": 80, "height": 24},
        "semanticSelection": {
            "id": "col:revenue",
            "targetId": "var:sales",
            "kind": "column",
            "granularity": "group",
            "label": "revenue",
            "parentId": "var:sales",
            "data": {
                "column": "revenue",
                "columnDtype": "int64",
                "hitKind": "body-cell",
            },
            "evidence": [
                {
                    "kind": "table-hit",
                    "hitKind": "body-cell",
                    "column": "revenue",
                }
            ],
            "highlight": {
                "kind": "elements",
                "strategy": "table-column",
                "boundingBox": {"x": 100, "y": 220, "width": 80, "height": 24},
            },
            "anchor": {
                "data": {
                    "hitKind": "body-cell",
                    "column": "revenue",
                }
            },
        },
        "context": {
            "semanticSelection": {
                "id": "col:revenue",
                "targetId": "var:sales",
                "kind": "column",
                "granularity": "group",
                "label": "revenue",
                "data": {"column": "revenue"},
                "evidence": [],
                "highlight": {"kind": "elements"},
                "anchor": {},
            },
        },
        "createdAt": "2026-05-19T00:00:00+00:00",
    }
    annotation.update(overrides)
    return annotation


def test_pair_feedback_packet_maps_annotation_cells_and_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike(), "threshold": 10})
    _install_context(monkeypatch, ctx)
    lens = Lens.restore(state=context.State(annotations=[_annotation()]))

    feedback = lens.export_pair_feedback()
    annotation = feedback["annotations"][0]

    assert feedback["protocol"] == "marimo-pair.feedback"
    assert feedback["summary"]["annotationCount"] == 1
    assert feedback["summary"]["hasBlocking"] is True
    assert feedback["summary"]["targetCells"] == ["cell-data", "cell-view"]
    assert feedback["groups"][0]["cellId"] == "cell-data"
    assert annotation["target"]["variable"] == "sales"
    assert annotation["target"]["column"] == "revenue"
    assert annotation["cells"]["definition"] == "cell-data"
    assert annotation["cells"]["display"] == "cell-view"
    assert (
        annotation["cells"]["previews"][0]["codePreview"] == "sales = pd.DataFrame(...)"
    )
    assert annotation["target"]["semanticSelection"]["kind"] == "column"
    assert annotation["evidence"]["semanticSelection"]["data"]["column"] == "revenue"
    assert "ctx.edit_cell" in annotation["marimoPair"]["editGuardrail"]
    assert lens.pair_feedback == feedback


def test_pair_feedback_markdown_formats_annotation_evidence() -> None:
    markdown = render_markdown(
        [_annotation()],
        {"filename": "demo.py"},
    )

    assert "Intent: `fix`" in markdown
    assert "Display cell: `cell-view`" in markdown
    assert "Selection: `column` revenue" in markdown
    assert "Sort the table by revenue descending." in markdown


def test_pair_feedback_prompt_includes_code_mode_and_lens_reporting_protocol(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike(), "threshold": 10})
    _install_context(monkeypatch, ctx)
    lens = Lens.restore(state=context.State(annotations=[_annotation()]))

    pair_prompt = lens.export_pair_prompt(refresh=False)

    assert "marimo._code_mode" in pair_prompt
    assert "from marimo_lens import find_lens" in pair_prompt
    assert 'lens.mark_cells([...], kind="edited")' in pair_prompt
    assert "lens.resolve_annotation" in pair_prompt
    assert "lens.agent_finished" in pair_prompt


def test_pair_feedback_json_serialization_smoke(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike(), "threshold": 10})
    _install_context(monkeypatch, ctx)
    lens = Lens.restore(state=context.State(annotations=[_annotation()]))

    payload = json.loads(lens.export_pair_json(refresh=False))

    assert payload["protocol"] == "marimo-pair.feedback"
    assert payload["annotations"][0]["id"] == "a1"


def test_pair_feedback_preserves_chart_part_context() -> None:
    chart_part = {
        "library": "altair",
        "kind": "axis",
        "label": "x axis",
        "detail": "quarter",
    }
    lens = Lens.restore(
        state=context.State(
            targets=[
                targets.visualization(
                    id="var:chart",
                    label="chart",
                )
            ],
            annotations=[
                {
                    "id": "a1",
                    "targetId": "var:chart",
                    "targetLabel": "chart",
                    "variable": "chart",
                    "kind": "visualization",
                    "chartPart": chart_part,
                    "comment": "Check the x-axis labels.",
                    "intent": "question",
                    "severity": "important",
                    "element": "g.role-axis",
                    "elementPath": "svg > g.role-axis",
                    "documentX": 1,
                    "documentY": 2,
                    "boundingBox": {"x": 1, "y": 2, "width": 3, "height": 4},
                    "semanticSelection": {
                        "id": "chart:axis:x-axis",
                        "targetId": "var:chart",
                        "kind": "axis",
                        "granularity": "group",
                        "label": "x axis",
                        "data": {"chartPart": chart_part},
                        "evidence": [],
                        "highlight": {"kind": "element"},
                        "anchor": {},
                    },
                    "context": {
                        "semanticSelection": {
                            "id": "chart:axis:x-axis",
                            "targetId": "var:chart",
                            "kind": "axis",
                            "granularity": "group",
                            "label": "x axis",
                            "data": {"chartPart": chart_part},
                            "evidence": [],
                            "highlight": {"kind": "element"},
                            "anchor": {},
                        },
                    },
                }
            ],
        ),
        source=context.mapping({}),
    )
    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert annotation["target"]["chartPart"] == chart_part
    assert "- Chart part: `altair:axis` x axis" in lens.export_markdown()


def test_pair_feedback_models_rendered_output_targets_separately() -> None:
    snapshot = context.Snapshot(
        notebook={
            "available": True,
            "cells": [
                {
                    "id": "cell-shape",
                    "defs": [],
                    "refs": ["movies"],
                    "outputRefs": [],
                    "outputType": "builtins.tuple",
                    "hasOutputExpression": True,
                    "codePreview": "movies.shape",
                }
            ],
            "definitions": {"movies": ["cell-data"]},
            "edges": [],
            "controls": {"summary": {}},
        }
    )
    lens = Lens.restore(
        state=context.State(
            snapshot=snapshot,
            targets=[
                targets.output(
                    id="output:cell-shape",
                    label="Output from cell cell-shape",
                    cell_id="cell-shape",
                    refs=["movies"],
                    output_type="builtins.tuple",
                    code_preview="movies.shape",
                    extensions={"hasOutputExpression": True},
                )
            ],
            annotations=[
                {
                    "id": "a-output",
                    "targetId": "output:cell-shape",
                    "targetLabel": "Output from cell cell-shape",
                    "kind": "output",
                    "cellId": "cell-shape",
                    "displayCellId": "cell-shape",
                    "comment": "This shape output is surprising.",
                    "semanticSelection": {
                        "id": "output:output:cell-shape",
                        "targetId": "output:cell-shape",
                        "kind": "output",
                        "granularity": "target",
                        "label": "Output from cell cell-shape",
                        "data": {"displayCellId": "cell-shape"},
                        "evidence": [{"kind": "dom-hit", "hitKind": "display-cell"}],
                        "highlight": {"kind": "element"},
                        "anchor": {},
                    },
                }
            ],
        ),
    )
    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert annotation["target"]["kind"] == "output"
    assert annotation["target"]["variable"] == ""
    assert annotation["target"]["refs"] == ["movies"]
    assert annotation["target"]["outputType"] == "builtins.tuple"
    assert annotation["target"]["codePreview"] == "movies.shape"
    assert annotation["cells"]["output"] == "cell-shape"
    assert annotation["cells"]["editFocus"] == "cell-shape"
    assert annotation["cells"]["previews"][0]["codePreview"] == "movies.shape"
    assert annotation["cells"]["previews"][0]["hasOutputExpression"] is True


def test_pair_feedback_preserves_annotation_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike()})
    _install_context(monkeypatch, ctx)

    lens = Lens.restore(
        state=context.State(
            annotations=[
                _annotation(
                    comment="Authorization: Bearer comment-secret",
                    severity="important",
                    context={
                        "semanticSelection": {
                            "id": "col:revenue",
                            "targetId": "var:sales",
                            "kind": "column",
                            "granularity": "group",
                            "label": "revenue",
                            "data": {"api_token": "context-secret"},
                            "evidence": [
                                {
                                    "kind": "table-hit",
                                    "header": "Authorization: Bearer context-bearer",
                                }
                            ],
                            "highlight": {"kind": "elements"},
                            "anchor": {},
                        },
                    },
                )
            ]
        )
    )
    serialized = lens.export_pair_json()

    assert "comment-secret" in serialized
    assert "context-secret" in serialized
    assert "context-bearer" in serialized
    assert "<redacted>" not in serialized


def test_pair_feedback_requires_current_annotation_targets() -> None:
    namespace: dict[str, Any] = {"sales": FrameLike()}
    lens = Lens.restore(
        state=context.State(
            annotations=[
                _annotation(
                    comment="Still relevant after rename.",
                    severity="important",
                    context={
                        "summary": "sales context",
                        "shape": {"rows": 2, "columns": 2},
                    },
                )
            ]
        ),
        source=context.mapping(namespace),
    )

    namespace.clear()
    namespace["orders"] = FrameLike()

    with pytest.raises(ValueError, match="current target set"):
        lens.refresh_context()


def test_build_pair_feedback_accepts_explicit_metadata_extensions() -> None:
    payload = build_pair_feedback(
        [],
        {"available": True},
        [],
        title="Lens",
        markdown="",
        metadata={"audience": "agent"},
    )

    assert payload["extensions"] == {"audience": "agent"}
    assert render_pair_prompt(payload) == ""
