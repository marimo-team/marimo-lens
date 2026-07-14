from __future__ import annotations

import json
from dataclasses import replace

import pytest

from marimo_lens._context import (
    MAX_CONTEXT_REFERENCES_BYTES,
    MAX_CONTEXT_TEXT_CHARACTERS,
    build_context,
    validate_selection_budget,
)
from marimo_lens._runtime import (
    MAX_CONTROL_CHARACTERS,
    MAX_CONTROLS,
    RuntimeControl,
    RuntimeSnapshot,
    serialize_controls,
)

from tests.support.factories import cell, selection, snapshot


def test_references_are_compact_and_text_is_standalone() -> None:
    runtime = replace(
        snapshot(
            cell(
                "cell-data",
                code="chart_source_sentinel = make_chart()",
                defs=("chart",),
            ),
            cell(
                "cell-view",
                code="chart_output_sentinel = chart",
                refs=("chart", "region"),
                upstream=("cell-data",),
            ),
        ),
        controls=(
            RuntimeControl(
                name="region",
                cell_ids=("cell-controls",),
                kind="marimo-ui",
                component="dropdown",
                label="Region",
                value="North",
            ),
            RuntimeControl(
                name="unrelated",
                cell_ids=("cell-controls",),
                kind="marimo-ui",
                component="switch",
                label="",
                value=True,
            ),
        ),
    )
    selected = selection(note="Compare this region.")

    references, text = build_context(
        runtime,
        [selected],
        revision=7,
        current_selection_id="selection-1",
    )
    compact = json.dumps(references, ensure_ascii=False, separators=(",", ":"))

    assert set(references) == {
        "protocol",
        "version",
        "revision",
        "generatedAt",
        "notebook",
        "currentSelectionId",
        "selections",
    }
    assert references["protocol"] == "marimo-lens.context"
    assert references["version"] == 1
    assert references["revision"] == 7
    assert references["currentSelectionId"] == "selection-1"
    assert references["notebook"] == {
        "path": "/workspace/demo.py",
        "available": True,
    }
    reference = references["selections"][0]
    assert set(reference) == {
        "id",
        "label",
        "note",
        "outputCellId",
        "cellStatus",
        "anchor",
        "domHint",
        "snapshot",
    }
    assert reference["note"] == "Compare this region."
    assert reference["cellStatus"] == "available"
    assert reference["snapshot"] == {"status": "pending"}
    assert len(compact.encode()) < 2_000
    assert "chart_source_sentinel" not in compact
    assert "chart_output_sentinel" not in compact
    assert "North" not in compact
    assert "\x89PNG" not in compact

    assert "S1 (current)" in text
    assert "Compare this region." in text
    assert "`cell-view`" in text
    assert text.count("chart_source_sentinel") == 1
    assert text.count("chart_output_sentinel") == 1
    assert "`region`" in text
    assert 'value: "North"' in text
    assert "unrelated" not in text
    assert "text-only workflow" in text


def test_empty_note_and_no_images_still_produce_complete_text() -> None:
    runtime = snapshot(cell("cell-view", code="result = compute()"))

    references, text = build_context(
        runtime,
        [selection(note="", snapshot={"status": "pending"})],
        revision=1,
        current_selection_id="selection-1",
    )

    assert references["selections"][0]["note"] == ""
    assert references["selections"][0]["snapshot"] == {"status": "pending"}
    assert "- Note: none" in text
    assert "- Snapshot: pending" in text
    assert "result = compute()" in text


def test_references_distinguish_missing_cells_from_unavailable_runtime() -> None:
    missing_references, missing_text = build_context(
        snapshot(),
        [selection(note="Look here.")],
        revision=0,
        current_selection_id="selection-1",
    )
    unavailable = RuntimeSnapshot(
        available=False,
        filename="",
        reason="not running in a marimo kernel",
        cells=(),
        controls=(),
    )
    unavailable_references, unavailable_text = build_context(
        unavailable,
        [selection(note="Look here.")],
        revision=0,
        current_selection_id="selection-1",
    )

    assert missing_references["selections"][0]["cellStatus"] == "missing"
    assert unavailable_references["selections"][0]["cellStatus"] == "unavailable"
    assert unavailable_references["notebook"] == {
        "path": "",
        "available": False,
        "reason": "not running in a marimo kernel",
    }
    assert "Look here." in missing_text
    assert "Look here." in unavailable_text
    assert "not running in a marimo kernel" in unavailable_text


def test_text_filters_controls_by_referenced_name() -> None:
    base = snapshot(
        cell(
            "cell-controls",
            code="region, threshold, hidden = controls()",
            defs=("hidden", "region", "threshold"),
        ),
        cell(
            "cell-filter",
            code="filtered = filter_sales(region.value, threshold.value)",
            defs=("filtered",),
            refs=("region", "threshold"),
            upstream=("cell-controls",),
        ),
        cell(
            "cell-view",
            code="render(filtered)",
            refs=("filtered",),
            upstream=("cell-filter",),
        ),
    )
    runtime = replace(
        base,
        controls=(
            _control("region", "North"),
            _control("threshold", 50),
            _control("hidden", True),
        ),
    )

    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert "controls" not in references
    assert "`region`" in text
    assert 'value: "North"' in text
    assert "`threshold`" in text
    assert "value: 50" in text
    control_section = text.split("## Current controls", 1)[1].split(
        "## Relevant cells", 1
    )[0]
    assert "hidden" not in control_section


def test_text_deduplicates_source_for_selections_on_one_cell() -> None:
    runtime = snapshot(cell("cell-view", code="single_source_sentinel = 1"))

    _references, text = build_context(
        runtime,
        [selection(), selection(selection_id="selection-2", label="S2")],
        revision=2,
        current_selection_id="selection-2",
    )

    assert text.count("single_source_sentinel") == 1
    assert "### S1" in text
    assert "### S2 (current)" in text


@pytest.mark.parametrize(
    ("snapshot_state", "expected"),
    [
        ({"status": "pending"}, "pending"),
        (
            {
                "status": "failed",
                "capturedAt": "2026-07-14T11:58:00Z",
                "error": "External frame cannot be captured",
            },
            "failed (External frame cannot be captured)",
        ),
        (
            {
                "status": "outdated",
                "id": "image:selection-1",
                "mediaType": "image/png",
                "width": 10,
                "height": 20,
                "sha256": "0" * 64,
                "capturedAt": "2026-07-14T11:58:00Z",
            },
            "outdated (10x20 PNG)",
        ),
    ],
)
def test_text_preserves_context_across_snapshot_states(
    snapshot_state: dict[str, object],
    expected: str,
) -> None:
    runtime = snapshot(cell("cell-view", code="source_sentinel = 42"))

    references, text = build_context(
        runtime,
        [selection(note="Investigate this.", snapshot=snapshot_state)],
        revision=1,
        current_selection_id="selection-1",
    )

    assert references["selections"][0]["snapshot"] == {
        "status": snapshot_state["status"]
    }
    assert "source_sentinel = 42" in text
    assert "Investigate this." in text
    assert expected in text


def test_context_reports_source_and_control_state_budgets() -> None:
    controls = tuple(
        RuntimeControl(
            name=f"control_{index}",
            cell_ids=("cell-view",),
            kind="anywidget",
            component="ExampleWidget",
            label="",
            value=["x" * 1_000] * 20,
        )
        for index in range(MAX_CONTROLS + 2)
    )
    runtime = replace(
        snapshot(
            cell(
                "cell-view",
                code="source_sentinel = " + "x" * 30_000,
                refs=tuple(control.name for control in controls),
            )
        ),
        controls=controls,
    )

    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert "Source was truncated" in text
    assert "2 relevant controls were omitted" in text
    assert "Current control state was truncated" in text
    assert "source_sentinel" not in json.dumps(references)


def test_control_serialization_uses_one_shared_character_budget() -> None:
    nested = ["x" * 1_000] * 20
    controls = tuple(
        RuntimeControl(
            name=f"control_{index}",
            cell_ids=("cell-view",),
            kind="anywidget",
            component="ExampleWidget",
            label="L" * 10_000,
            value=nested,
        )
        for index in range(MAX_CONTROLS)
    )

    serialized = serialize_controls(controls)
    encoded = json.dumps(
        [control.value for control in serialized.controls],
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )

    assert len(encoded) <= MAX_CONTROL_CHARACTERS
    assert serialized.state_truncated is True
    assert [control.name for control in serialized.controls] == [
        f"control_{index}" for index in range(MAX_CONTROLS)
    ]


def test_context_enforces_independent_reference_and_text_budgets() -> None:
    selections = [
        selection(
            selection_id=f"selection-{index + 1}",
            label=f"S{index + 1}",
            note=f"note-{index}-" + "x" * 3_980,
            output_cell_id=f"cell-{index}",
        )
        for index in range(9)
    ]
    runtime = replace(
        snapshot(
            *(
                cell(
                    f"cell-{index}",
                    code=f"source_{index} = " + "y" * 4_000,
                )
                for index in range(9)
            )
        ),
        filename="🧪" * 3_000,
    )

    references, text = build_context(
        runtime,
        selections,
        revision=9,
        current_selection_id="selection-9",
    )
    reference_bytes = len(
        json.dumps(references, ensure_ascii=False, separators=(",", ":")).encode()
    )

    assert reference_bytes <= MAX_CONTEXT_REFERENCES_BYTES
    assert len(references["notebook"]["path"].encode()) <= 2_048
    assert len(text) <= MAX_CONTEXT_TEXT_CHARACTERS
    assert "Some selection notes or DOM hints were truncated" in text
    assert "Some cell metadata or source was truncated" in text
    assert all(f"### S{index + 1}" in text for index in range(9))


def test_context_rejects_aggregate_selection_growth() -> None:
    selections = [
        selection(
            selection_id=f"selection-{index + 1}",
            label=f"S{index + 1}",
            note="x" * 4_000,
        )
        for index in range(10)
    ]

    with pytest.raises(ValueError, match="shared 40,000-byte limit"):
        validate_selection_budget(selections)


def test_text_uses_a_fence_longer_than_source_backticks() -> None:
    source = 'markdown = mo.md("""\n```python\nprint(1)\n```\n""")'
    runtime = snapshot(cell("cell-view", code=source))

    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert "~~~python\n" in text
    assert "\n~~~" in text
    assert source in text


def _control(name: str, value: object) -> RuntimeControl:
    return RuntimeControl(
        name=name,
        cell_ids=("cell-controls",),
        kind="marimo-ui",
        component="control",
        label="",
        value=value,
    )
