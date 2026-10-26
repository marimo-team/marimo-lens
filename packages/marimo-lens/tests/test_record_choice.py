from __future__ import annotations

import pathlib
import re
from typing import Any, cast

import pytest
from marimo_lens import Lens, LensError, Record, agent
from marimo_lens._marimo.adapter import MarimoRuntimeAdapter

from tests.support.browser import BrowserLens
from tests.support.factories import png, record_lines, selection
from tests.support.kernel import SALES, FakeNotebook


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        (False, None),
        (True, Record()),
        ({}, Record()),
        ({"keep": "session"}, Record(keep="session")),
        ({"images": False, "history": False}, Record(images=False, history=False)),
        (Record(keep="session", images=False), Record(keep="session", images=False)),
    ],
)
def test_lens_record_returns_the_record_each_form_describes(
    value: Any, expected: Record | None
) -> None:
    lens = Lens(record=value)

    assert lens.record == expected
    assert agent.MountedLens("identity", lens).record == expected
    lens.close()


def test_record_reads_like_its_constructor() -> None:
    assert repr(Record(keep="session", images=False)) == (
        "Record(keep='session', images=False, history=True)"
    )


@pytest.mark.parametrize(
    ("fields", "error", "message"),
    [
        ({"keep": "disk"}, ValueError, "keep must be 'notebook' or 'session'"),
        ({"images": "yes"}, TypeError, "images must be True or False"),
        ({"history": 1}, TypeError, "history must be True or False"),
    ],
)
def test_record_validates_its_fields(
    fields: dict[str, Any], error: type[Exception], message: str
) -> None:
    with pytest.raises(error, match=message):
        Record(**fields)
    with pytest.raises(error, match=message):
        Lens(record=cast(Any, fields))


def test_record_takes_keyword_fields_only() -> None:
    with pytest.raises(TypeError, match="positional"):
        Record(*cast(Any, ("notebook",)))


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (
            "yes",
            "record must be True, False, None, a dict of record options, or a Record",
        ),
        ({"show": False}, "record has no option 'show'. Use keep, images, or history."),
    ],
)
def test_lens_rejects_a_record_it_cannot_read(value: object, message: str) -> None:
    with pytest.raises(TypeError, match=re.escape(message)):
        Lens(record=cast(Any, value))


def test_lens_without_a_record_writes_no_file_and_opens_no_journal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    def journal(self: MarimoRuntimeAdapter, storage: str) -> None:
        raise AssertionError(f"Lens() opened a {storage} journal")

    monkeypatch.setattr(MarimoRuntimeAdapter, "journal", journal)
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    chat = lens.open_request("Explain the dip", cells=["cell-net"])
    notebook.set("cell-net", "net = sales")
    lens.resolve(["selection-1", chat], expected_revision=lens.revision)
    lens.context()
    lens.check()

    assert not (tmp_path / "__marimo__").exists()


def test_resolve_without_a_record_closes_requests_and_sends_the_receipt(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    chat = lens.open_request("Explain the dip")

    revision = lens.resolve(["selection-1", chat], expected_revision=lens.revision)

    event = lens.sent[-1][0]
    assert (event["type"], event["revision"]) == ("selection.resolved", revision)
    assert [item["selectionId"] for item in event["payload"]["selections"]] == [
        "selection-1"
    ]
    assert lens.synced_state()["selections"] == []
    assert lens.context().references["chatRequests"] == []


def test_history_without_a_record_says_how_to_keep_one(notebook: FakeNotebook) -> None:
    context = BrowserLens().context()

    assert context.references["notebook"]["record"] is None
    with pytest.raises(LensError) as raised:
        context.history()
    assert raised.value.code == "record_off"
    assert "Lens(record=True)" in str(raised.value)


def test_check_without_a_record_runs_no_record_rules(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    recorded = BrowserLens(record=True)
    recorded.put(selection(output_cell_id="cell-chart"))
    recorded.resolve("selection-1", expected_revision=recorded.revision)
    recorded.close()
    [record] = tmp_path.rglob("*.jsonl")
    with record.open("a") as handle:
        handle.write('{"schema": "edited by hand"\n')

    assert BrowserLens().check() == []
    assert [item["code"] for item in BrowserLens(record=True).check()] == ["LR001"]


def test_record_without_images_writes_lines_that_name_no_png(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = BrowserLens(record={"images": False})
    data = png()
    lens.put(selection(output_cell_id="cell-chart"), image=data)
    assert lens.context().images == {"selection-1": data}

    lens.resolve("selection-1", expected_revision=lens.revision)

    [line] = record_lines(tmp_path / "sales.py")
    assert line["trace"]["image"] is None
    assert not (tmp_path / "__marimo__" / "lens" / "images").exists()
    [entry] = lens.history_entries()
    assert entry["id"] == "selection-1"
    assert "image" not in entry
    [row] = lens.context().history()
    assert row["image"] is None


@pytest.mark.parametrize("record", [None, {"history": False}])
def test_lens_without_history_publishes_none_and_refuses_history_commands(
    notebook: FakeNotebook, record: Any
) -> None:
    lens = BrowserLens(record=record)
    lens.put(selection(output_cell_id="cell-chart"))
    lens.resolve("selection-1", expected_revision=lens.revision)

    assert lens._history is None
    assert lens.refused("history.refresh", {}) == "history_off"
    assert lens.refused("history.image", {"sha256": "0" * 64}) == "history_off"
    assert (
        lens.refused(
            "selection.reopen",
            {
                "selectionId": "selection-1",
                "resolvedAt": "2026-01-01T00:00:00+00:00",
                "documentId": "document-1",
                "documentPath": "/",
                "expectedRevision": lens.revision,
            },
        )
        == "history_off"
    )
    assert lens._history is None


def test_record_without_history_still_answers_agents(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = BrowserLens(record={"history": False})
    lens.put(selection(output_cell_id="cell-chart"))
    lens.resolve("selection-1", expected_revision=lens.revision)

    assert [row["id"] for row in lens.context().history()] == ["selection-1"]
    assert [line["id"] for line in record_lines(tmp_path / "sales.py")] == [
        "selection-1"
    ]


def test_lenses_with_different_storage_keep_separate_records_and_one_label_sequence(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    session = BrowserLens(record={"keep": "session"})
    saved = BrowserLens(record=True, dom_selector="#report")
    session.put(selection(selection_id="session-1"))
    saved.put(selection(selection_id="saved-1"))

    session.resolve("session-1", expected_revision=session.revision)
    saved.resolve("saved-1", expected_revision=saved.revision)

    assert [row["label"] for row in session.context().history()] == ["S1"]
    assert [row["label"] for row in saved.context().history()] == ["S2"]
    assert [line["id"] for line in record_lines(tmp_path / "sales.py")] == ["saved-1"]


def test_a_saved_record_continues_labels_for_a_lens_created_after_a_session_lens(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    first = BrowserLens(record=True)
    first.put(selection(output_cell_id="cell-chart"))
    first.resolve("selection-1", expected_revision=first.revision)
    first.close()
    FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES))

    session = BrowserLens(record={"keep": "session"})
    saved = BrowserLens(record=True, dom_selector="#report")
    session.put(selection(selection_id="session-1"))
    saved.put(selection(selection_id="saved-1"))

    assert [item["label"] for item in session.synced_state()["selections"]] == ["S2"]
    assert [item["label"] for item in saved.synced_state()["selections"]] == ["S3"]
