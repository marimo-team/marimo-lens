from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest
from marimo_lens import RecordedRequest, Selection, notebook_context, record_request
from marimo_lens.__main__ import main

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
    pointed = selection(
        selection_id="r1", note="Drop small sales", output_cell_id=net_id
    )
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
        pointed,
        summary="Raised the cut.",
        resolved_at=live[0]["resolvedAt"],
        opened_at=live[0]["openedAt"],
        record=from_files,
    )
    recorded = notebook_context(notebook, record=from_files).history()

    assert request_id == "r1"
    assert _changes(live[0]) == [("net", "in_force")]
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

    with pytest.raises(ValueError, match=message):
        record_request(before, before, Selection(cell="net"), **times)
    assert not (tmp_path / "__marimo__").exists()


def test_cli_records_requests_beside_the_notebook(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    notebook = _write(tmp_path, "sales.py", FILTERED)
    _write(tmp_path / "states", "r1-before.py", SALES)
    _write(tmp_path / "states", "r1-after.py", FILTERED)
    requests = _write(
        tmp_path,
        "requests.json",
        json.dumps(
            [
                {
                    "before": "states/r1-before.py",
                    "after": "states/r1-after.py",
                    "selection": {
                        "cell": "net",
                        "note": "Drop small sales",
                        "mark": [0.4, 0.3],
                        "id": "r1",
                    },
                    "summary": "Raised the cut.",
                    "resolved_at": "2026-09-02T10:12:00Z",
                }
            ]
        ),
    )

    assert main(["record", str(notebook), str(requests)]) == 0
    assert capsys.readouterr().out == "r1\n"
    assert main(["context", str(notebook), "--cell", "net", "--format", "history"]) == 0
    [row] = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert (row["id"], row["summary"]) == ("r1", "Raised the cut.")


def test_cli_names_the_request_it_cannot_record(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    notebook = _write(tmp_path, "sales.py", SALES)
    requests = _write(
        tmp_path, "requests.json", json.dumps([{"before": "sales.py", "after": 3}])
    )

    assert main(["record", str(notebook), str(requests)]) == 2
    assert "Request 1 needs a selection with a cell." in capsys.readouterr().err
