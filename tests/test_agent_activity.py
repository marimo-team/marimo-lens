from __future__ import annotations

import pytest

from marimo_lens import Lens
from marimo_lens import context
from marimo_lens.agent_activity import (
    build_agent_finished,
    build_agent_started,
    build_annotation_status,
    build_cell_mark,
    build_focus_command,
    build_pair_result,
    render_pair_result_prompt,
)


def test_agent_started_returns_run_id_and_activity() -> None:
    run_id, activity = build_agent_started(run_id=None, label="pair")

    assert run_id.startswith("run-")
    assert activity["kind"] == "agent-started"
    assert activity["actor"]["label"] == "pair"
    assert activity["actor"]["runId"] == run_id


def test_cell_marks_normalize_ids_and_reject_invalid_status() -> None:
    activity = build_cell_mark(
        ["cell-a", "cell-a", 3],
        kind="edited",
        note="done",
        run_id="run-1",
    )

    assert activity["cellIds"] == ["cell-a", "3"]
    assert activity["status"] == "edited"
    assert activity["note"] == "done"

    with pytest.raises(ValueError, match="Unknown Lens agent cell mark kind"):
        build_cell_mark(["cell-a"], kind="changed", run_id="run-1")
    with pytest.raises(ValueError, match="at least one cell id"):
        build_cell_mark([], kind="edited", run_id="run-1")


def test_annotation_status_normalizes_ids_and_rejects_invalid_status() -> None:
    activity = build_annotation_status(
        123,
        status="addressed",
        note="resolved",
        run_id="run-1",
    )

    assert activity["annotationIds"] == ["123"]
    assert activity["status"] == "addressed"

    with pytest.raises(ValueError, match="Unknown Lens annotation status"):
        build_annotation_status("a1", status="done", run_id="run-1")
    with pytest.raises(ValueError, match="requires an annotation id"):
        build_annotation_status("", status="addressed", run_id="run-1")


def test_agent_finished_summary_and_invalid_status() -> None:
    activity = build_agent_finished(
        summary="Edited the filter and reran the chart.",
        run_id="run-demo",
        cells_read=["cell-a", "cell-b"],
        cells_edited=["cell-b"],
        cells_run=["cell-b", "cell-c"],
        annotations_addressed=["ml-123"],
    )

    assert activity["kind"] == "agent-finished"
    assert activity["cellIds"] == ["cell-a", "cell-b", "cell-c"]
    assert activity["details"] == {
        "cellsRead": ["cell-a", "cell-b"],
        "cellsEdited": ["cell-b"],
        "cellsRun": ["cell-b", "cell-c"],
        "annotationsAddressed": ["ml-123"],
    }
    with pytest.raises(ValueError, match="Unknown Lens agent finish status"):
        build_agent_finished(summary="bad", run_id="run-demo", status="done")


def test_focus_command_requires_cell_id() -> None:
    command = build_focus_command("cell-a", reason="Review edited output")

    assert command["kind"] == "focus-cell"
    assert command["cellId"] == "cell-a"
    assert command["reason"] == "Review edited output"

    with pytest.raises(ValueError, match="requires a cell id"):
        build_focus_command("")


def test_pair_result_summarizes_activity_questions_and_warnings() -> None:
    activity = [
        build_cell_mark(["cell-a"], kind="read", run_id="run-1"),
        build_cell_mark(["cell-b"], kind="edited", run_id="run-1"),
        build_cell_mark(["cell-c"], kind="ran", run_id="run-1"),
        build_cell_mark(
            ["cell-d"],
            kind="needs-review",
            note="Choose a threshold",
            run_id="run-1",
        ),
        build_cell_mark(["cell-e"], kind="failed", note="Run failed", run_id="run-1"),
        build_annotation_status("ml-1", status="addressed", run_id="run-1"),
    ]
    result = build_pair_result(activity)

    assert result["summary"] == {
        "cellsRead": 1,
        "cellsEdited": 1,
        "cellsRun": 1,
        "annotationsAddressed": 1,
    }
    assert result["openQuestions"][0]["note"] == "Choose a threshold"
    assert result["warnings"][0]["status"] == "failed"
    assert "marimo-pair.result" in render_pair_result_prompt(result)


def test_lens_agent_activity_records_cell_marks_and_pair_result() -> None:
    lens = Lens(source=context.mapping({}))

    run_id = lens.agent_started(label="marimo-pair")
    activity = lens.mark_cells(
        ["cell-a"],
        kind="edited",
        note="Edited filter logic and reran downstream chart",
    )

    assert activity["kind"] == "cell-mark"
    assert activity["status"] == "edited"
    assert activity["cellIds"] == ["cell-a"]
    assert activity["actor"]["runId"] == run_id
    assert activity["provenance"] == {
        "origin": "agent",
        "source": "marimo-pair",
        "protocol": "marimo-lens.agent-activity",
        "version": 1,
    }
    assert lens.agent_activity[-1] == activity
    assert lens.pair_result["summary"]["cellsEdited"] == 1


def test_lens_resolve_annotation_hides_terminal_marker_and_links_activity() -> None:
    annotation = {
        "id": "ml-123",
        "targetId": "manual:thing",
        "targetLabel": "Thing",
        "comment": "Please check this output.",
        "intent": "fix",
        "severity": "important",
        "element": "div",
        "elementPath": "div",
        "documentX": 0,
        "documentY": 0,
        "boundingBox": {"x": 0, "y": 0, "width": 1, "height": 1},
    }
    lens = Lens.restore(
        state=context.State(
            targets=[{"id": "manual:thing", "label": "Thing", "kind": "object"}],
            annotations=[annotation],
        ),
        source=context.mapping({}),
    )
    activity = lens.resolve_annotation(
        "ml-123",
        status="addressed",
        note="Updated the cell and reran the chart.",
    )

    assert lens.annotations == []
    assert activity["kind"] == "annotation-status"
    assert activity["annotationIds"] == ["ml-123"]
    assert activity["status"] == "addressed"
    assert activity["details"]["annotation"]["comment"] == "Please check this output."
    assert lens.pair_result["summary"]["annotationsAddressed"] == 1

    with pytest.raises(ValueError, match="unknown Lens annotation"):
        lens.resolve_annotation("missing", status="addressed")


def test_lens_resolve_annotation_keeps_marker_for_non_terminal_status() -> None:
    annotation = {
        "id": "ml-123",
        "targetId": "manual:thing",
        "targetLabel": "Thing",
        "comment": "Please check this output.",
        "intent": "fix",
        "severity": "important",
        "element": "div",
        "elementPath": "div",
        "documentX": 0,
        "documentY": 0,
        "boundingBox": {"x": 0, "y": 0, "width": 1, "height": 1},
    }
    lens = Lens.restore(
        state=context.State(
            targets=[{"id": "manual:thing", "label": "Thing", "kind": "object"}],
            annotations=[annotation],
        ),
        source=context.mapping({}),
    )

    activity = lens.resolve_annotation(
        "ml-123",
        status="blocked",
        note="Needs a human decision before editing.",
    )

    assert lens.annotations == [annotation]
    assert activity["status"] == "blocked"


def test_lens_agent_finished_exports_machine_readable_result_packet() -> None:
    lens = Lens(source=context.mapping({}))
    lens.agent_started(run_id="run-demo")

    activity = lens.agent_finished(
        "Edited the filter and reran the chart.",
        cells_read=["cell-a", "cell-b"],
        cells_edited=["cell-b"],
        cells_run=["cell-b", "cell-c"],
        annotations_addressed=["ml-123"],
    )
    result = lens.export_pair_result()

    assert activity["kind"] == "agent-finished"
    assert result["protocol"] == "marimo-pair.result"
    assert result["source"] == {"package": "marimo-lens", "agent": "marimo-pair"}
    assert result["summary"] == {
        "cellsRead": 2,
        "cellsEdited": 1,
        "cellsRun": 2,
        "annotationsAddressed": 1,
    }
    assert result["activity"][-1]["note"] == "Edited the filter and reran the chart."
    assert "marimo-pair.result" in lens.export_pair_result_prompt()


def test_lens_focus_cell_queues_frontend_command() -> None:
    lens = Lens(source=context.mapping({}))

    command = lens.focus_cell("cell-a", reason="Review edited output")

    assert command["kind"] == "focus-cell"
    assert command["cellId"] == "cell-a"
    assert lens.agent_commands[-1] == command
