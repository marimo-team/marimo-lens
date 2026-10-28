from __future__ import annotations

import pathlib
from typing import Any

import pytest
from marimo_lens import (
    ChatRequest,
    RecordedRequest,
    Selection,
    notebook_context,
    record_request,
)

from tests.support.browser import BrowserLens
from tests.support.factories import selection
from tests.support.files import SALES, kernel_cells, start_kernel

FILTERED = SALES.replace("sales[sales.amount > 0]", "sales[sales.amount > 100]")
INSERTED = FILTERED.replace(
    "@app.cell\ndef net(sales):",
    "@app.cell\ndef threshold():\n    limit = 100\n    return (limit,)\n\n\n"
    "@app.cell\ndef net(sales):",
)


def _write(folder: pathlib.Path, name: str, source: str) -> pathlib.Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(source)
    return path


def _changes(row: RecordedRequest) -> list[tuple[str | None, str]]:
    return [(change["name"], change["status"]) for change in row["changes"]]


def test_a_recorded_request_reads_as_one_resolved_through_a_live_lens(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    notebook = _write(tmp_path / "live", "sales.py", SALES)
    kernel = start_kernel(monkeypatch, notebook)
    net_id = kernel_cells(notebook)["net"][0]
    pointed = {
        **selection(selection_id="r1", note="Drop small sales", output_cell_id=net_id),
        # The widget describes a plain output by its cell's name.
        "description": {"label": "net"},
    }
    lens = BrowserLens(record=True)
    lens.put(pointed)
    kernel.set(net_id, "net = sales[sales.amount > 100]")
    lens.resolve("r1", expected_revision=lens.revision, summary="Raised the cut.")
    notebook.write_text(FILTERED)
    live = notebook_context(notebook).history()
    from_files = tmp_path / "files" / "record.jsonl"

    request_id = record_request(
        _write(tmp_path / "files", "before.py", SALES),
        _write(tmp_path / "files", "after.py", FILTERED),
        Selection(
            cell="net",
            note="Drop small sales",
            mark=(0.25, 0.75),
            dom_hint=pointed["domHint"],
            id="r1",
        ),
        summary="Raised the cut.",
        resolved_at=live[0]["resolvedAt"],
        opened_at=live[0]["openedAt"],
        record=from_files,
    )
    recorded = notebook_context(notebook, record=from_files).history()

    assert request_id == "r1"
    assert _changes(live[0]) == [("net", "in_force")]
    assert recorded == live


def test_a_recorded_chat_request_reads_as_one_resolved_through_a_live_lens(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    notebook = _write(tmp_path / "live", "sales.py", SALES)
    kernel = start_kernel(monkeypatch, notebook)
    net_id = kernel_cells(notebook)["net"][0]
    lens = BrowserLens(record=True)
    chat_id = lens.open_request("Drop small sales", cells=[net_id])
    kernel.set(net_id, "net = sales[sales.amount > 100]")
    lens.resolve(chat_id, expected_revision=lens.revision, summary="Raised the cut.")
    notebook.write_text(FILTERED)
    live = notebook_context(notebook).history()
    from_files = tmp_path / "files" / "record.jsonl"

    request_id = record_request(
        _write(tmp_path / "files", "before.py", SALES),
        _write(tmp_path / "files", "after.py", FILTERED),
        ChatRequest("Drop small sales", cells=("net",), id=chat_id),
        summary="Raised the cut.",
        resolved_at=live[0]["resolvedAt"],
        opened_at=live[0]["openedAt"],
        record=from_files,
    )
    recorded = notebook_context(notebook, record=from_files).history()

    assert request_id == chat_id
    assert (live[0]["channel"], _changes(live[0])) == ("chat", [("net", "in_force")])
    assert recorded == live


def test_an_added_cell_is_new_and_an_edited_cell_keeps_its_id(
    tmp_path: pathlib.Path,
) -> None:
    after = _write(tmp_path, "after.py", INSERTED)
    record = tmp_path / "record.jsonl"

    record_request(
        _write(tmp_path, "before.py", SALES),
        after,
        Selection(cell="net", note="Drop small sales"),
        summary="Moved the cut into its own cell.",
        resolved_at="2026-09-02T10:12:00Z",
        record=record,
    )

    [row] = notebook_context(after, record=record).history()
    assert sorted(_changes(row)) == [("net", "in_force"), ("threshold", "in_force")]
    assert row["label"] == "S1"
    assert row["resolvedAt"] == "2026-09-02T10:12:00Z"


def test_a_later_request_that_reverts_a_change_undoes_it(
    tmp_path: pathlib.Path,
) -> None:
    original = _write(tmp_path, "original.py", SALES)
    filtered = _write(tmp_path, "filtered.py", FILTERED)
    record = tmp_path / "record.jsonl"

    record_request(
        original,
        filtered,
        Selection(cell="net", note="Drop small sales", id="r1"),
        resolved_at="2026-09-02T10:12:00Z",
        record=record,
    )
    record_request(
        filtered,
        original,
        Selection(cell="revenue_chart", note="Show every sale again", id="r2"),
        resolved_at="2026-09-03T09:00:00Z",
        record=record,
    )

    first, second = notebook_context(original, record=record).history()
    assert [first["label"], second["label"]] == ["S1", "S2"]
    assert first["changes"][0]["status"] == "undone"
    assert first["changes"][0]["undoneBy"] == "r2"
    assert _changes(second) == [("net", "in_force")]


@pytest.mark.parametrize(
    ("times", "message"),
    [
        ({"resolved_at": "yesterday"}, "resolved_at must be an ISO 8601 time"),
        (
            {
                "resolved_at": "2026-09-02T10:00:00Z",
                "opened_at": "2026-09-02T11:00:00Z",
            },
            "comes after resolved_at",
        ),
    ],
)
def test_request_times_must_be_ordered_iso_times(
    tmp_path: pathlib.Path, times: dict[str, Any], message: str
) -> None:
    before = _write(tmp_path, "before.py", SALES)
    record = tmp_path / "record.jsonl"

    with pytest.raises(ValueError, match=message):
        record_request(before, before, Selection(cell="net"), record=record, **times)
    assert not record.exists()


def test_a_request_is_recorded_once_per_resolution(tmp_path: pathlib.Path) -> None:
    notebook = _write(tmp_path, "sales.py", SALES)
    record = tmp_path / "record.jsonl"
    request = ChatRequest("Is the cut right?", cells=("net",), id="c1")
    record_request(
        notebook, notebook, request, record=record, resolved_at="2026-09-02T10:12:00Z"
    )

    with pytest.raises(ValueError, match="already holds request 'c1'"):
        record_request(
            notebook,
            notebook,
            request,
            record=record,
            resolved_at="2026-09-02T10:12:00+00:00",
        )
    record_request(
        notebook, notebook, request, record=record, resolved_at="2026-09-03T10:12:00Z"
    )
    rows = notebook_context(notebook, record=record).history()
    assert [row["id"] for row in rows] == ["c1", "c1"]


def test_a_record_lens_cannot_write_fails_the_request(tmp_path: pathlib.Path) -> None:
    before = _write(tmp_path, "before.py", SALES)
    # A directory stands where the record file belongs.
    unwritable = tmp_path / "record.jsonl"
    unwritable.mkdir()

    with pytest.raises(OSError, match="could not write the record"):
        record_request(
            before,
            before,
            ChatRequest("Why?"),
            resolved_at="2026-09-02T10:12:00Z",
            record=unwritable,
        )
