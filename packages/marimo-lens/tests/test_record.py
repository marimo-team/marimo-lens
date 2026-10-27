from __future__ import annotations

import pathlib
import sys
from dataclasses import replace

import pytest
from marimo_lens._notebook.snapshot import RuntimeSnapshot
from marimo_lens._record.lines import serialize_line

from tests.support.browser import RecordBrowserLens
from tests.support.factories import (
    cell,
    record_line,
    record_lines,
    selection,
    snapshot,
)
from tests.support.kernel import FakeNotebook


def test_resolve_writes_one_line_with_the_request_and_its_changes(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(note="Central looks off", output_cell_id="cell-chart"))
    notebook.set(
        "cell-net", 'net = sales[(sales.amount > 0) & (sales.kind != "refund")]'
    )

    lens.resolve(
        "selection-1", expected_revision=lens.revision, summary="Dropped refunds."
    )

    [line] = record_lines(tmp_path / "sales.py")
    assert line["schema"] == "marimo-lens.record/1"
    assert line["id"] == "selection-1"
    assert line["channel"] == "selection"
    assert line["label"] == "S1"
    assert line["note"] == "Central looks off"
    assert line["summary"] == "Dropped refunds."
    assert line["revision"] == 2
    assert [cell["cellId"] for cell in line["trace"]["cells"]] == ["cell-chart"]
    assert line["trace"]["target"]["cellIds"] == ["cell-chart"]
    assert line["trace"]["anchor"] == {"kind": "point", "x": 0.25, "y": 0.75}
    [change] = line["changes"]
    codes = {code["hash"]: code for code in line["codes"]}
    assert change["cellId"] == "cell-net"
    assert codes[change["before"]]["text"] == "net = sales[sales.amount > 0]"
    assert codes[change["after"]]["text"].endswith('(sales.kind != "refund")]')
    assert codes[change["after"]]["defs"] == ["net"]
    assert line["concurrent"] == []
    assert line["baseline"] == {
        "status": "complete",
        "reason": None,
        "repeated": [],
        "alike": [],
    }
    assert lens.context().references["notebook"]["record"] == {"status": "saved"}


def test_batch_resolve_writes_one_line_per_selection_naming_each_other(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="selection-1", label="S1", note="Too high"))
    lens.put(selection(selection_id="selection-2", label="S2", note="Too low"))

    lens.resolve(
        ["selection-1", "selection-2"],
        expected_revision=lens.revision,
        summary="Checked both.",
    )

    lines = record_lines(tmp_path / "sales.py")
    assert [(line["id"], line["note"]) for line in lines] == [
        ("selection-1", "Too high"),
        ("selection-2", "Too low"),
    ]
    assert [line["concurrent"] for line in lines] == [["selection-2"], ["selection-1"]]
    assert {line["revision"] for line in lines} == {3}


def test_changes_include_added_deleted_and_edited_cells(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales[sales.amount >= 0]")
    notebook.set("cell-refunds", "refunds = sales[sales.amount < 0]")
    notebook.delete("cell-data")

    lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "sales.py")
    changes = {
        change["cellId"]: (change["before"] is None, change["after"] is None)
        for change in line["changes"]
    }
    assert changes == {
        "cell-data": (False, True),
        "cell-net": (False, False),
        "cell-refunds": (True, False),
    }


def test_reopened_selection_takes_a_fresh_baseline(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales")
    lens.resolve("selection-1", expected_revision=lens.revision)
    [entry] = lens.history_entries()
    lens.command(
        "selection.reopen",
        {
            "selectionId": "selection-1",
            "resolvedAt": entry["resolvedAt"],
            "documentId": "document-1",
            "documentPath": "/",
            "expectedRevision": lens.revision,
        },
    )
    notebook.set("cell-data", "sales = load(fresh=True)")

    lens.resolve("selection-1", expected_revision=lens.revision)

    first, second = record_lines(tmp_path / "sales.py")
    assert [change["cellId"] for change in first["changes"]] == ["cell-net"]
    assert [change["cellId"] for change in second["changes"]] == ["cell-data"]


def test_record_follows_the_python_cache_prefix(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    prefix = tmp_path / "cache"
    monkeypatch.setattr(sys, "pycache_prefix", str(prefix))
    notebook = tmp_path / "work" / "sales.py"
    FakeNotebook(monkeypatch, notebook, {"cell-chart": "chart()"})
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))

    lens.resolve("selection-1", expected_revision=lens.revision)

    relative = notebook.parent.relative_to(notebook.anchor)
    path = prefix / relative / "__marimo__" / "lens" / "sales.py.jsonl"
    assert len(path.read_text(encoding="utf-8").splitlines()) == 1
    assert not (notebook.parent / "__marimo__").exists()


def test_failed_write_keeps_the_resolution_and_retries_with_the_next_one(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    blocker = tmp_path / "__marimo__"
    blocker.write_text("a file where the folder belongs")
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="selection-1", label="S1"))

    revision = lens.resolve("selection-1", expected_revision=lens.revision)

    assert revision == lens.revision
    record = lens.context().references["notebook"]["record"]
    assert record is not None
    assert record["status"] == "failed"
    assert "could not write the record" in record.get("reason", "")

    blocker.unlink()
    lens.put(selection(selection_id="selection-2", label="S2"))
    lens.resolve("selection-2", expected_revision=lens.revision)

    assert [line["id"] for line in record_lines(tmp_path / "sales.py")] == [
        "selection-1",
        "selection-2",
    ]
    assert lens.context().references["notebook"]["record"] == {"status": "saved"}


def test_unsaved_notebook_keeps_lines_until_it_has_a_file_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    notebook = FakeNotebook(monkeypatch, None, {"cell-chart": "chart()"})
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    lens.resolve("selection-1", expected_revision=lens.revision)
    unsaved = lens.context().references["notebook"]["record"]
    saved = tmp_path / "untitled.py"
    notebook.context.globals["__file__"] = str(saved)

    record = lens.context().references["notebook"]["record"]

    assert unsaved == {
        "status": "unsaved",
        "reason": "The notebook has no file name yet.",
    }
    assert record == {"status": "saved"}
    assert [line["id"] for line in record_lines(saved)] == ["selection-1"]


def test_a_notebook_beyond_the_cell_bound_marks_the_baseline_incomplete(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    FakeNotebook(
        monkeypatch,
        tmp_path / "large.py",
        {f"cell-{index}": f"value_{index} = {index}" for index in range(1_005)},
    )
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-0"))

    lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "large.py")
    assert line["baseline"]["status"] == "incomplete"
    assert "5 cells beyond the 1,000" in line["baseline"]["reason"]


def test_runtime_outside_marimo_records_an_incomplete_baseline() -> None:
    unavailable = RuntimeSnapshot(
        available=False,
        filename="",
        reason="not running in a marimo kernel",
        available_cell_ids=frozenset(),
        cells=(),
        controls=(),
    )

    line = record_line("chat-1", unavailable, unavailable)

    assert line.changes == ()
    assert line.baseline.status == "incomplete"
    assert "not running in a marimo kernel" in (line.baseline.reason or "")


def test_a_cell_only_the_document_shows_is_not_attributed_to_a_request(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-broken", "y = (")

    with notebook.code_mode():
        lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "sales.py")
    assert line["changes"] == []


def test_an_edit_that_breaks_a_cell_records_its_text(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    # marimo drops a cell from its graph when new code fails to compile.
    notebook.set("cell-net", "net = sales[")

    with notebook.code_mode():
        lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "sales.py")
    [change] = line["changes"]
    codes = {code["hash"]: code["text"] for code in line["codes"]}
    assert change["cellId"] == "cell-net"
    assert codes[change["after"]] == "net = sales["


def test_names_beyond_the_record_bound_do_not_block_the_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    long_name = "n" * 300
    FakeNotebook(monkeypatch, tmp_path / "sales.py", {"cell-chart": f"{long_name} = 1"})
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))

    lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "sales.py")
    assert line["codes"][0]["defs"] == []
    assert lens.context().references["notebook"]["record"] == {"status": "saved"}


def test_a_cell_only_a_graph_only_baseline_missed_counts_as_added_with_a_gap() -> None:
    after = replace(
        snapshot(cell("cell-a", code="x = 1"), cell("cell-net", code="net = 1")),
        document=True,
    )

    line = record_line("chat-1", {"cell-a": "x = 1"}, after)

    [change] = line.changes
    assert (change.cell_id, change.before) == ("cell-net", None)
    assert line.baseline.status == "incomplete"
    assert "only marimo's graph" in (line.baseline.reason or "")


def test_a_cell_nested_past_the_recursion_limit_still_records_and_reports(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    notebook.set("cell-steps", "steps = sales" + ".pipe(step)" * 300)
    lens = RecordBrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-steps", "steps = sales" + ".pipe(step)" * 301)

    lens.resolve(
        "selection-1", expected_revision=lens.revision, summary="One more step."
    )

    [line] = record_lines(tmp_path / "sales.py")
    assert [change["cellId"] for change in line["changes"]] == ["cell-steps"]
    [entry] = lens.history_entries()
    assert [change["status"] for change in entry["changes"]] == ["in_force"]
    assert lens.check() == []


def test_a_line_over_its_byte_bound_leaves_out_only_its_largest_codes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._record import lines

    monkeypatch.setattr(lines, "MAX_LINE_BYTES", 6_000)
    before = snapshot(
        cell("cell-a", code="a = 1"),
        cell("cell-b", code="b = 1"),
        cell("cell-c", code="c = 1"),
    )
    after = snapshot(
        cell("cell-a", code="a = '" + "x" * 4_000 + "'"),
        cell("cell-b", code="b = '" + "y" * 2_500 + "'"),
        cell("cell-c", code="c = 2"),
    )

    line = record_line("chat-1", before, after)

    assert len(serialize_line(line)) <= 6_000
    kept = {code.text[:5] for code in line.codes}
    assert kept == {"a = 1", "b = 1", "c = 1", "b = '", "c = 2"}
    assert line.baseline.reason == "code beyond the 6,000-byte line bound was left out"
