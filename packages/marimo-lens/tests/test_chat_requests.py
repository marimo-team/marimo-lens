from __future__ import annotations

import json
import pathlib
import threading
from collections.abc import Sequence
from typing import Any, cast

import pytest
from marimo._core.document import code_hash
from marimo_lens import LensError, agent
from marimo_lens._core.bounds import MAX_NOTE
from marimo_lens._marimo.adapter import MarimoRuntimeAdapter
from marimo_lens._notebook.snapshot import RuntimeSnapshot
from marimo_lens._selection.references import MAX_CHAT_REFERENCES_BYTES

from tests.support.browser import BrowserLens
from tests.support.factories import record_lines, selection
from tests.support.kernel import FakeNotebook


def test_a_chat_request_opens_in_one_call_and_resolves_in_another(
    notebook: FakeNotebook, tmp_path: pathlib.Path
) -> None:
    lens = BrowserLens(record=True)
    mounted = agent.MountedLens("identity", lens)

    request_id = mounted.open_request(
        "Drop refunds from the revenue chart", cells=["cell-chart"]
    )
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    context = mounted.context()
    revision = mounted.resolve(
        request_id,
        expected_revision=context.revision,
        summary="Filtered refunds in cell-net.",
    )

    assert request_id.startswith("chat-")
    assert revision == context.revision == 0
    [line] = record_lines(tmp_path / "sales.py")
    assert line["id"] == request_id
    assert line["channel"] == "chat"
    assert line["label"] is None
    assert line["note"] == "Drop refunds from the revenue chart"
    assert [cell["cellId"] for cell in line["trace"]["cells"]] == ["cell-chart"]
    assert line["trace"]["target"] is None
    assert [change["cellId"] for change in line["changes"]] == ["cell-net"]
    [row] = mounted.context().history()
    assert row["channel"] == "chat"
    assert row["cellIds"] == ["cell-chart"]
    assert row["changes"][0]["status"] == "in_force"


def test_open_chat_requests_appear_beside_selections(notebook: FakeNotebook) -> None:
    lens = BrowserLens()
    lens.put(selection(note="Central looks off", output_cell_id="cell-chart"))
    request_id = lens.open_request("Explain the dip", cells=["cell-net"])

    references = lens.context().references

    assert [item["id"] for item in references["selections"]] == ["selection-1"]
    [chat] = references["chatRequests"]
    assert chat["id"] == request_id
    assert chat["note"] == "Explain the dip"
    assert chat["cells"] == [
        {
            "id": "cell-net",
            "status": "available",
            "codeHash": code_hash("net = sales[sales.amount > 0]"),
        }
    ]
    assert chat["openedAt"]


def test_a_batch_resolves_both_channels_and_names_their_overlap(
    notebook: FakeNotebook, tmp_path: pathlib.Path
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(note="Central looks off", output_cell_id="cell-chart"))
    request_id = lens.open_request("Also round the totals")

    revision = lens.resolve(
        ["selection-1", request_id],
        expected_revision=lens.revision,
        summary="Checked both.",
    )

    assert revision == 2
    lines = record_lines(tmp_path / "sales.py")
    assert [(line["id"], line["concurrent"]) for line in lines] == [
        ("selection-1", [request_id]),
        (request_id, ["selection-1"]),
    ]
    assert lens.context().references["chatRequests"] == []


def test_only_a_batch_with_a_selection_checks_the_revision(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    request_id = lens.open_request("Explain the dip")
    lens.put(selection(output_cell_id="cell-chart"))

    with pytest.raises(LensError) as error:
        lens.resolve([request_id, "selection-1"], expected_revision=0)

    assert error.value.code == "revision_conflict"
    assert lens.resolve(request_id, expected_revision=0) == 1


def test_a_chat_request_open_when_lens_closes_leaves_no_record(
    notebook: FakeNotebook, tmp_path: pathlib.Path
) -> None:
    lens = BrowserLens()
    lens.open_request("Explain the dip")

    lens.close()

    assert record_lines(tmp_path / "sales.py") == []


def test_a_chat_request_must_name_cells_in_the_notebook(notebook: FakeNotebook) -> None:
    lens = BrowserLens()

    with pytest.raises(LensError) as error:
        lens.open_request("Explain the dip", cells=["cell-gone"])

    assert error.value.code == "cell_not_found"
    assert lens.context().references["chatRequests"] == []


@pytest.mark.parametrize(
    ("note", "cells", "error_type", "message"),
    [
        (" ", None, ValueError, "quote the analyst's request"),
        ("x" * 4_001, None, ValueError, "at most 4,000 UTF-16 code units"),
        (3, None, TypeError, "note must be a string"),
        ("Explain", "cell-chart", TypeError, "sequence of cell IDs"),
        ("Explain", ["cell-chart", "cell-chart"], ValueError, "duplicates"),
        ("Explain", [f"cell-{index}" for index in range(17)], ValueError, "16"),
    ],
)
def test_open_request_validates_its_arguments(
    notebook: FakeNotebook,
    note: object,
    cells: object,
    error_type: type[Exception],
    message: str,
) -> None:
    lens = BrowserLens()

    with pytest.raises(error_type, match=message):
        lens.open_request(cast(Any, note), cast(Any, cells))


def test_the_chat_request_limit_holds_across_lens_instances(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    lens, other = BrowserLens(), BrowserLens(dom_selector="#report")
    for index in range(15):
        lens.open_request(f"Request {index}")
    read = MarimoRuntimeAdapter.notebook
    pending = [other]

    # Another Lens opens a request while this one reads the notebook.
    def read_while_another_opens(
        self: MarimoRuntimeAdapter, cell_ids: Sequence[str] = ()
    ) -> RuntimeSnapshot:
        snapshot = read(self, cell_ids)
        if pending:
            pending.pop().open_request("Opened meanwhile")
        return snapshot

    monkeypatch.setattr(MarimoRuntimeAdapter, "notebook", read_while_another_opens)

    with pytest.raises(LensError) as error:
        lens.open_request("One too many")

    assert error.value.code == "request_limit_reached"
    assert len(lens.context().references["chatRequests"]) == 16


def test_named_cells_are_checked_in_a_notebook_past_the_cell_bound(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    filename = tmp_path / "large.py"
    FakeNotebook(
        monkeypatch,
        filename,
        {f"cell-{index}": f"x{index} = {index}" for index in range(1_001)},
    )
    lens = BrowserLens(record=True)

    with pytest.raises(LensError) as error:
        lens.open_request("Explain", cells=["cell-gone"])
    request_id = lens.open_request("Explain", cells=["cell-1000"])
    lens.resolve(request_id, expected_revision=lens.revision)

    assert error.value.code == "cell_not_found"
    [line] = record_lines(filename)
    [traced] = line["trace"]["cells"]
    assert traced["cellId"] == "cell-1000"
    assert traced["code"] is not None


def test_long_chat_notes_shorten_oldest_first_within_their_budget(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    # More full-length notes than the chat budget holds.
    count = MAX_CHAT_REFERENCES_BYTES // MAX_NOTE + 2
    note = "x" * (MAX_NOTE - 3)
    for index in range(count):
        lens.open_request(f"{index:02} {note}")

    chats = lens.context().references["chatRequests"]

    size = len(json.dumps({"chatRequests": chats}, separators=(",", ":")).encode())
    assert size <= MAX_CHAT_REFERENCES_BYTES
    assert chats[0]["note"] == ""
    assert chats[-1]["note"] == f"{count - 1:02} {note}"


def test_a_request_opened_while_a_cell_was_out_of_reach_says_so(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    path = tmp_path / "sales.py"
    notebook = FakeNotebook(monkeypatch, path, {"cell-a": "x = 1", "cell-b": "x"})
    lens = BrowserLens(record=True)
    notebook.set("cell-a", "x = [")
    with notebook.code_mode():
        lens.context()
    # Outside code mode, the kernel's graph lacks the cell that does not parse.
    request_id = lens.open_request("Repair the syntax", cells=["cell-b"])
    notebook.set("cell-a", "x = 2")
    with notebook.code_mode():
        lens.resolve(request_id, expected_revision=lens.revision)

    [line] = record_lines(path)

    assert line["changes"] == []
    assert line["baseline"]["status"] == "incomplete"
    assert "could not read the code of 1 cell" in line["baseline"]["reason"]


def test_every_lens_of_the_runtime_shows_open_chat_requests_oldest_first(
    notebook: FakeNotebook,
) -> None:
    asked, other = BrowserLens(), BrowserLens()

    first = asked.open_request("Why is Central low?", cells=["cell-net"])
    second = asked.open_request("Add a 2026 column")

    for lens in (asked, other):
        chats = lens.synced_chats()
        assert [(chat["id"], chat["note"]) for chat in chats] == [
            (first, "Why is Central low?"),
            (second, "Add a 2026 column"),
        ]
        assert all(chat["openedAt"] for chat in chats)


def test_resolving_a_chat_request_removes_it_from_every_lens(
    notebook: FakeNotebook,
) -> None:
    asked, other = BrowserLens(), BrowserLens()
    request_id = asked.open_request("Why is Central low?")

    other.resolve(request_id, expected_revision=other.revision, summary="Answered.")

    assert asked.synced_chats() == []
    assert other.synced_chats() == []


def test_a_chat_request_reaches_a_lens_busy_in_another_thread(
    notebook: FakeNotebook,
) -> None:
    asked, other = BrowserLens(), BrowserLens()
    opened = threading.Event()
    worker = threading.Thread(
        target=lambda: (asked.open_request("Why is Central low?"), opened.set()),
        daemon=True,
    )

    # Holding the other Lens's lock stands in for a call such as context()
    # that holds it and then waits for the runtime lock open_request holds.
    with other._lock:
        worker.start()
        published = opened.wait(timeout=5)
    worker.join(timeout=5)

    assert published
    assert len(other.synced_chats()) == 1


def test_a_lens_created_later_shows_chat_requests_already_open(
    notebook: FakeNotebook,
) -> None:
    first = BrowserLens()
    request_id = first.open_request("Why is Central low?")

    later = BrowserLens()

    assert [chat["id"] for chat in later.synced_chats()] == [request_id]


def test_a_closed_lens_stops_following_chat_requests(notebook: FakeNotebook) -> None:
    open_lens, closed = BrowserLens(), BrowserLens()
    closed.close()

    open_lens.open_request("Why is Central low?")

    assert closed.synced_chats() == []


def test_a_failing_chat_watcher_leaves_the_request_open_and_other_lenses_current(
    notebook: FakeNotebook,
) -> None:
    broken = BrowserLens()

    def fail(chats: object) -> None:
        raise RuntimeError("watcher failed")

    broken._runtime.requests.watch_chats(fail)
    other = BrowserLens()

    request_id = broken.open_request("Why is Central low?")

    assert [chat["id"] for chat in other.synced_chats()] == [request_id]


def test_resolving_a_closed_chat_request_reports_it_missing_at_any_revision(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    request_id = lens.open_request("Make it blue", cells=["cell-chart"])
    lens.resolve(request_id, expected_revision=lens.revision, summary="Done.")
    stale = lens.revision
    lens.put(selection(selection_id="selection-later", label="S1"))

    with pytest.raises(LensError) as error:
        lens.resolve(request_id, expected_revision=stale, summary="Done again.")

    assert error.value.code == "request_not_found"
