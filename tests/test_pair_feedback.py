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

from tests.support.feedback_fixtures import chart_annotation
from tests.support.feedback_fixtures import table_annotation as _annotation
from tests.support.sample_entities import FrameLike
from tests.support.runtime_contexts import _install_context, _runtime_context


def test_pair_feedback_packet_maps_annotation_cells_and_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike(), "threshold": 10})
    _install_context(monkeypatch, ctx)
    lens = Lens.restore(state=context.State(annotations=[_annotation()]))

    feedback = lens.export_pair_feedback()
    annotation = feedback["annotations"][0]

    assert feedback["protocol"] == "marimo-pair.feedback"
    assert feedback["targets"]
    assert feedback["targetIndex"]["var:sales"]["cellId"] == "cell-data"
    assert feedback["contextPolicy"]["redaction"] == "none"
    assert feedback["displayProvenance"][0]["targetStatus"] == "current"
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
    assert annotation["targetSnapshot"]["id"] == "var:sales"
    assert annotation["evidence"]["semanticSelection"]["data"]["column"] == "revenue"
    assert annotation["marimoPair"]["action"] == "fix"
    assert annotation["marimoPair"]["editBoundary"]["mode"] == "marimo-code-mode"
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


def test_pair_feedback_sanitizes_extension_and_annotation_context_values() -> None:
    payload = build_pair_feedback(
        [
            _annotation(
                semanticSelection={
                    "id": "col:revenue",
                    "targetId": "var:sales",
                    "kind": "column",
                    "granularity": "group",
                    "label": "revenue",
                    "data": {"raw": object()},
                    "evidence": [{"raw": object()}],
                    "highlight": {"kind": "elements"},
                    "anchor": {},
                },
                context={"selectionContext": {"raw": object()}},
                domEvidence={
                    "element": "td",
                    "elementPath": "table td",
                    "documentPoint": {"raw": object()},
                    "boundingBox": {"raw": object()},
                },
            )
        ],
        {"available": True, "definitions": {}, "edges": [], "controls": {}},
        [{"id": "var:sales", "label": "sales", "kind": "dataframe"}],
        title="Lens",
        markdown="",
        metadata={"raw": object()},
    )

    json.dumps(payload)
    assert payload["extensions"]["raw"]["type"] == "builtins.object"
    annotation = payload["annotations"][0]
    assert (
        annotation["evidence"]["semanticSelection"]["data"]["raw"]["type"]
        == "builtins.object"
    )
    assert (
        annotation["evidence"]["context"]["selectionContext"]["raw"]["type"]
        == "builtins.object"
    )


def test_pair_feedback_preserves_typed_control_strings_after_sanitizing() -> None:
    payload = build_pair_feedback(
        [],
        {
            "available": True,
            "controls": {
                "uiElements": [
                    {
                        "name": "site_filter",
                        "kind": "ui",
                        "pythonType": "marimo._plugins.ui._impl.input.dropdown",
                        "cellIds": ["cell-controls"],
                        "args": {"options": ["All", {"raw": object()}]},
                    }
                ],
                "traitletsObjects": [
                    {
                        "name": "review_state",
                        "kind": "traitlets",
                        "pythonType": "__main__.ReviewState",
                        "cellIds": ["cell-state"],
                        "traits": ["selected_site", "threshold"],
                        "state": {"raw": object()},
                    }
                ],
            },
        },
        [],
        title="Lens",
        markdown="",
    )

    controls = payload["notebook"]["controls"]
    assert controls["uiElements"][0]["cellIds"] == ["cell-controls"]
    assert controls["traitletsObjects"][0]["cellIds"] == ["cell-state"]
    assert controls["traitletsObjects"][0]["traits"] == [
        "selected_site",
        "threshold",
    ]
    assert controls["traitletsObjects"][0]["state"]["raw"]["type"] == "builtins.object"
    assert (
        controls["uiElements"][0]["args"]["options"][1]["raw"]["type"]
        == "builtins.object"
    )


def test_pair_feedback_sanitizes_cyclic_notebook_graph_values() -> None:
    cyclic: dict[str, Any] = {}
    cyclic["self"] = cyclic

    payload = build_pair_feedback(
        [],
        {"available": True, "runtime": {"cyclic": cyclic}},
        [],
        title="Lens",
        markdown="",
    )

    json.dumps(payload)
    assert payload["notebook"]["runtime"]["cyclic"]["self"]["type"] == "builtins.dict"


def test_pair_feedback_bounds_notebook_graph_values() -> None:
    payload = build_pair_feedback(
        [],
        {
            "available": True,
            "runtime": {
                "longText": "x" * 1_000,
                "manyItems": {str(index): index for index in range(30)},
                "manyListItems": list(range(30)),
            },
        },
        [],
        title="Lens",
        markdown="",
    )

    runtime = payload["notebook"]["runtime"]

    assert runtime["longText"] == ("x" * 500) + "..."
    assert len(runtime["manyItems"]) == 20
    assert "20" not in runtime["manyItems"]
    assert runtime["manyListItems"] == list(range(20))


def test_pair_feedback_preserves_notebook_global_chart_parts() -> None:
    payload = build_pair_feedback(
        [],
        {
            "available": True,
            "globals": [
                {
                    "name": "chart",
                    "kind": "visualization",
                    "pythonType": "altair.Chart",
                    "cellIds": ["chart-cell"],
                    "chart": {
                        "library": "altair",
                        "parts": [
                            {
                                "library": "altair",
                                "kind": "axis",
                                "label": "x axis",
                                "detail": "year",
                            }
                        ],
                    },
                }
            ],
        },
        [],
        title="Lens",
        markdown="",
    )

    part = payload["notebook"]["globals"][0]["chart"]["parts"][0]

    assert part == {
        "library": "altair",
        "kind": "axis",
        "label": "x axis",
        "detail": "year",
    }


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
            annotations=[chart_annotation(chart_part)],
        ),
        source=context.mapping({}),
    )
    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert annotation["target"]["chartPart"] == chart_part
    assert "- Chart part: `altair:axis` x axis" in lens.export_markdown()


def test_pair_feedback_moves_chart_part_extras_into_extensions() -> None:
    chart_part = {
        "library": "altair",
        "kind": "axis",
        "label": "x axis",
        "internalScore": 0.9,
    }
    lens = Lens.restore(
        state=context.State(
            targets=[targets.visualization(id="var:chart", label="chart")],
            annotations=[chart_annotation(chart_part)],
        ),
        source=context.mapping({}),
    )

    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert "internalScore" not in annotation["target"]["chartPart"]
    assert annotation["target"]["chartPart"]["extensions"]["internalScore"] == 0.9


def test_pair_feedback_ignores_annotation_context_chart_part_fallbacks() -> None:
    lens = Lens.restore(
        state=context.State(
            targets=[targets.visualization(id="var:chart", label="chart")],
            annotations=[
                {
                    "id": "a1",
                    "targetId": "var:chart",
                    "targetLabel": "chart",
                    "variable": "chart",
                    "kind": "visualization",
                    "comment": "Check the chart.",
                    "context": {
                        "chartPart": {
                            "library": "altair",
                            "kind": "axis",
                            "label": "discarded context axis",
                        },
                    },
                }
            ],
        ),
        source=context.mapping({}),
    )

    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert annotation["target"]["chartPart"] is None
    assert "discarded context axis" not in lens.export_pair_json(refresh=False)


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
                    semanticSelection={
                        "id": "col:revenue",
                        "targetId": "var:sales",
                        "kind": "column",
                        "granularity": "group",
                        "label": "revenue",
                        "data": {"api_token": "semantic-secret"},
                        "evidence": [
                            {
                                "kind": "table-hit",
                                "header": "Authorization: Bearer semantic-bearer",
                            }
                        ],
                        "highlight": {"kind": "elements"},
                        "anchor": {},
                    },
                    context={
                        "selectionContext": {
                            "api_token": "context-secret",
                            "header": "Authorization: Bearer context-bearer",
                        },
                    },
                )
            ]
        )
    )
    serialized = lens.export_pair_json()

    assert "comment-secret" in serialized
    assert "semantic-secret" in serialized
    assert "semantic-bearer" in serialized
    assert "context-secret" in serialized
    assert "context-bearer" in serialized
    assert "<redacted>" not in serialized


def test_pair_feedback_keeps_stale_annotation_targets_from_evidence() -> None:
    namespace: dict[str, Any] = {"sales": FrameLike()}
    lens = Lens.restore(
        state=context.State(
            annotations=[
                _annotation(
                    comment="Still relevant after rename.",
                    severity="important",
                    targetSnapshot={
                        "id": "var:sales",
                        "label": "sales",
                        "kind": "dataframe",
                        "variable": "sales",
                        "cellId": "cell-data",
                        "displayCellIds": ["cell-view"],
                        "summary": "sales context",
                        "shape": {"rows": 2, "columns": 2},
                    },
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

    lens.refresh_context()
    annotation = lens.pair_feedback["annotations"][0]

    assert annotation["target"]["id"] == "var:sales"
    assert annotation["target"]["status"] == "snapshot"
    assert annotation["target"]["summary"] == "sales context"
    assert annotation["target"]["shape"] == {"rows": 2, "columns": 2}


def test_pair_feedback_marks_missing_annotation_targets_diagnostic() -> None:
    lens = Lens.restore(
        state=context.State(
            annotations=[
                _annotation(
                    comment="The original target disappeared.",
                    severity="important",
                )
            ]
        ),
        source=context.mapping({"orders": FrameLike()}),
    )

    annotation = lens.export_pair_feedback(refresh=False)["annotations"][0]

    assert annotation["target"]["id"] == "var:sales"
    assert annotation["target"]["status"] == "missing"
    assert annotation["target"]["kind"] == "diagnostic"
    assert annotation["target"]["defs"] == []
    assert annotation["target"]["refs"] == []
    assert annotation["cells"]["related"] == []
    assert annotation["marimoPair"]["editBoundary"]["cellIds"] == []
    assert annotation["marimoPair"]["readBeforeEdit"] == []
    assert annotation["marimoPair"]["runAfterEdit"] == []
    assert (
        "Do not edit from this stale Lens annotation alone"
        in annotation["marimoPair"]["recommendedAction"]
    )


def test_pair_feedback_prefers_refreshed_current_target_cells_over_annotation_cells() -> (
    None
):
    payload = build_pair_feedback(
        [
            _annotation(
                cellId="old-cell",
                displayCellId="old-display",
            )
        ],
        {
            "available": True,
            "cells": [
                {
                    "id": "new-cell",
                    "defs": ["sales"],
                    "refs": [],
                    "outputRefs": [],
                    "codePreview": "sales = fresh()",
                },
                {
                    "id": "new-display",
                    "defs": [],
                    "refs": ["sales"],
                    "outputRefs": ["sales"],
                    "codePreview": "sales",
                },
            ],
            "definitions": {"sales": ["new-cell"]},
            "edges": [{"from": "new-cell", "to": "new-display"}],
            "controls": {},
        },
        [
            {
                "id": "var:sales",
                "label": "sales",
                "kind": "dataframe",
                "variable": "sales",
                "cellId": "new-cell",
                "displayCellIds": ["new-display"],
            }
        ],
        title="Lens",
        markdown="",
    )

    annotation = payload["annotations"][0]

    assert annotation["cells"]["definition"] == "new-cell"
    assert annotation["cells"]["display"] == "new-display"
    assert annotation["marimoPair"]["editBoundary"]["cellIds"] == [
        "new-cell",
        "new-display",
    ]


def test_pair_feedback_ignores_stale_current_target_cells_not_in_graph() -> None:
    payload = build_pair_feedback(
        [_annotation(cellId="old-cell", displayCellId="old-display")],
        {
            "available": True,
            "cells": [
                {
                    "id": "fresh-cell",
                    "defs": ["sales"],
                    "refs": [],
                    "outputRefs": [],
                    "codePreview": "sales = fresh()",
                },
                {
                    "id": "fresh-view",
                    "defs": [],
                    "refs": ["sales"],
                    "outputRefs": ["sales"],
                    "codePreview": "sales",
                },
            ],
            "definitions": {"sales": ["fresh-cell"]},
            "edges": [{"from": "fresh-cell", "to": "fresh-view"}],
            "controls": {},
        },
        [
            {
                "id": "var:sales",
                "label": "sales",
                "kind": "dataframe",
                "variable": "sales",
                "cellId": "missing-current-cell",
                "displayCellIds": ["missing-current-display"],
                "relatedCellIds": ["missing-related-cell"],
            }
        ],
        title="Lens",
        markdown="",
    )

    annotation = payload["annotations"][0]

    assert annotation["cells"]["definition"] == "fresh-cell"
    assert "missing-current-cell" not in annotation["cells"]["related"]
    assert "missing-current-display" not in annotation["cells"]["related"]
    assert "missing-related-cell" not in annotation["cells"]["related"]
    assert annotation["marimoPair"]["editBoundary"]["cellIds"] == ["fresh-cell"]
    assert annotation["marimoPair"]["runAfterEdit"] == ["fresh-cell"]


def test_pair_feedback_rejects_current_target_cells_when_graph_cells_missing() -> None:
    payload = build_pair_feedback(
        [_annotation(cellId="old-cell", displayCellId="old-display")],
        {
            "available": True,
            "definitions": {"sales": ["new-cell"]},
            "edges": [{"from": "new-cell", "to": "new-display"}],
            "controls": {},
        },
        [
            {
                "id": "var:sales",
                "label": "sales",
                "kind": "dataframe",
                "variable": "sales",
                "cellId": "missing-current-cell",
                "displayCellIds": ["missing-current-display"],
                "relatedCellIds": ["missing-related-cell"],
            }
        ],
        title="Lens",
        markdown="",
    )

    annotation = payload["annotations"][0]

    assert annotation["cells"]["definition"] == ""
    assert annotation["cells"]["display"] == ""
    assert annotation["cells"]["related"] == []
    assert annotation["marimoPair"]["editBoundary"]["cellIds"] == []
    assert annotation["marimoPair"]["readBeforeEdit"] == []
    assert annotation["marimoPair"]["runAfterEdit"] == []


def test_pair_feedback_uses_annotation_target_snapshot_when_current_target_is_gone() -> (
    None
):
    payload = build_pair_feedback(
        [
            _annotation(
                targetSnapshot={
                    "id": "var:orders",
                    "label": "sales",
                    "kind": "dataframe",
                    "variable": "sales",
                    "cellId": "cell-data",
                    "displayCellIds": ["cell-view"],
                    "refs": ["pd"],
                    "summary": "snapshot summary",
                }
            )
        ],
        {"available": True, "definitions": {}, "edges": [], "controls": {}},
        [],
        title="Lens",
        markdown="",
    )
    annotation = payload["annotations"][0]

    assert annotation["target"]["status"] == "snapshot"
    assert annotation["target"]["id"] == "var:sales"
    assert annotation["targetSnapshot"]["id"] == "var:sales"
    assert annotation["target"]["summary"] == "snapshot summary"
    assert annotation["target"]["refs"] == ["pd"]
    assert annotation["cells"]["definition"] == ""
    assert annotation["cells"]["display"] == ""
    assert annotation["cells"]["related"] == []
    assert annotation["marimoPair"]["editBoundary"]["cellIds"] == []
    assert annotation["marimoPair"]["readBeforeEdit"] == []
    assert annotation["marimoPair"]["runAfterEdit"] == []
    assert (
        "Do not edit from this stale Lens annotation alone"
        in annotation["marimoPair"]["recommendedAction"]
    )


@pytest.mark.parametrize(
    ("annotation", "match"),
    [
        (_annotation(intent="rewrite"), "unknown intent"),
        (_annotation(severity="urgent"), "unknown severity"),
        (
            _annotation(
                semanticSelection={
                    "id": "bad",
                    "targetId": "var:sales",
                    "kind": "column",
                    "granularity": "pixel",
                    "label": "sales",
                    "data": {},
                    "evidence": [],
                    "highlight": {"kind": "element"},
                    "anchor": {},
                }
            ),
            "unknown selection granularity",
        ),
        (
            _annotation(
                chartPart={"library": "custom", "kind": "tooltip", "label": "tip"}
            ),
            "unknown chart part kind",
        ),
        (
            _annotation(chartPart={"library": "custom", "kind": "axis"}),
            "chart part requires label",
        ),
        (
            _annotation(chartPart={"library": "custom", "label": "x axis"}),
            "chart part requires kind",
        ),
    ],
)
def test_pair_feedback_rejects_unknown_annotation_contract_values(
    annotation: dict[str, Any],
    match: str,
) -> None:
    with pytest.raises(ValueError, match=match):
        build_pair_feedback(
            [annotation],
            {"available": True, "definitions": {}, "edges": [], "controls": {}},
            [{"id": "var:sales", "label": "sales", "kind": "dataframe"}],
            title="Lens",
            markdown="",
        )


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


def test_pair_feedback_reporting_protocol_uses_valid_literal_examples() -> None:
    payload = build_pair_feedback(
        [_annotation()],
        {"available": True, "definitions": {}, "edges": [], "controls": {}},
        [{"id": "var:sales", "label": "sales", "kind": "dataframe"}],
        title="Lens",
        markdown="",
    )

    protocol = payload["annotations"][0]["marimoPair"]["reportingProtocol"]

    assert "read|claimed" not in json.dumps(protocol)
    assert "addressed|blocked" not in json.dumps(protocol)
    assert protocol["markEdited"] == "lens.mark_cells(cell_ids, kind='edited')"
    assert (
        protocol["resolveAddressed"]
        == "lens.resolve_annotation(annotation_id, status='addressed', note='...')"
    )
