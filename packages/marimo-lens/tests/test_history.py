from __future__ import annotations

import itertools
import json
import os
import pathlib
import uuid
from types import SimpleNamespace

import pytest

from tests.support.browser import RecordBrowserLens
from tests.support.factories import png, selection
from tests.support.kernel import SALES, FakeNotebook

REFUNDS = "net = sales[sales.kind != 'refund']"


def _resolve(lens: RecordBrowserLens, selection_id: str, label: str, note: str) -> None:
    lens.put(
        selection(
            selection_id=selection_id,
            label=label,
            note=note,
            output_cell_id="cell-chart",
        )
    )
    lens.resolve(selection_id, expected_revision=lens.revision, summary="Done.")


def test_history_lists_both_channels_with_the_status_of_each_change(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", REFUNDS)
    lens.resolve("s1", expected_revision=lens.revision, summary="Dropped refunds.")
    note = "Show refunds again " + "📉" * 250
    chat = lens.open_request(note, cells=["cell-net"])
    notebook.set("cell-net", SALES["cell-net"])
    lens.resolve(chat, expected_revision=lens.revision, summary="Restored.")

    first, second = lens.history_entries()

    assert (first["id"], first["channel"], first["label"]) == ("s1", "selection", "S1")
    assert first["changes"] == [
        {
            "cellId": "cell-net",
            "status": "undone",
            "undoneBy": chat,
            "missing": ["net = sales[sales.kind != 'refund']"],
        }
    ]
    assert first["selection"]["target"]["cellIds"] == ["cell-chart"]
    assert (second["id"], second["channel"]) == (chat, "chat")
    assert "label" not in second
    assert "selection" not in second
    assert second["changes"] == [{"cellId": "cell-net", "status": "in_force"}]
    assert lens.synced_history()["record"] == {"status": "saved"}


def test_history_survives_a_kernel_restart_and_labels_continue(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Too high")
    _resolve(lens, "s2", "S2", "Too low")
    lens.close()
    FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES))

    # Labels continue before any browser view has loaded.
    restarted = RecordBrowserLens(displayed=False)
    restarted.put(selection(selection_id="s3", label="S1"))

    assert [item["label"] for item in restarted.synced_state()["selections"]] == ["S3"]
    assert [entry["id"] for entry in restarted.history_entries()] == ["s1", "s2"]


def test_labels_continue_after_a_selection_another_kernel_resolved(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    first = RecordBrowserLens()
    first.put(selection(selection_id="s1", output_cell_id="cell-chart"))
    # A second kernel serves the same notebook file.
    FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES))
    second = RecordBrowserLens()
    first.resolve("s1", expected_revision=first.revision)

    second.put(selection(selection_id="s2", output_cell_id="cell-chart"))

    [opened] = second.synced_state()["selections"]
    assert opened["label"] == "S2"


def test_refresh_reports_a_change_undone_after_history_was_published(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", REFUNDS)
    lens.resolve("s1", expected_revision=lens.revision)
    notebook.set("cell-net", "net = sales")

    stale = lens.history_entries()[0]["changes"][0]["status"]
    response = lens.command("history.refresh", {})
    fresh = lens.history_entries()[0]["changes"][0]

    assert stale == "in_force"
    assert response["revision"] == lens.revision
    assert fresh == {
        "cellId": "cell-net",
        "status": "undone",
        "undoneBy": "unrecorded",
        "missing": ["net = sales[sales.kind != 'refund']"],
    }


def test_a_failed_projection_keeps_the_history_browsers_show(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    import marimo_lens._session.session as session_module

    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Central looks off")
    shown = lens.synced_history()

    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("projection failed")

    monkeypatch.setattr(session_module, "history_state", fail)
    lens.command("history.refresh", {})

    assert lens.synced_history() == shown


def test_refresh_cannot_judge_a_cell_the_kernel_cannot_parse(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales[")
    with notebook.code_mode():
        lens.resolve("s1", expected_revision=lens.revision)
        agent = lens.context().history()[0]["changes"]

    lens.command("history.refresh", {})
    refreshed = lens.history_entries()[0]["changes"]
    # The analyst deletes the cell, which the kernel never registered.
    notebook.delete("cell-net")
    lens.command("history.refresh", {})
    deleted = lens.history_entries()[0]["changes"]

    assert [(change["cellId"], change["status"]) for change in agent] == [
        ("cell-net", "in_force")
    ]
    assert refreshed == [{"status": "unknown"}]
    assert deleted == [{"status": "unknown"}]


def test_refresh_reports_a_deletion_the_last_code_mode_call_saw(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", REFUNDS)
    with notebook.code_mode():
        lens.resolve("s1", expected_revision=lens.revision)
    notebook.delete("cell-net")

    lens.command("history.refresh", {})
    unseen = lens.history_entries()[0]["changes"]
    with notebook.code_mode():
        lens.context()
    lens.command("history.refresh", {})
    seen = lens.history_entries()[0]["changes"]

    assert unseen == [{"status": "unknown"}]
    assert seen == [
        {
            "status": "undone",
            "undoneBy": "unrecorded",
            "missing": ["net = sales[sales.kind != 'refund']"],
        }
    ]


def test_reopen_follows_the_cell_and_moves_the_target_to_the_asking_document(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Central looks off")
    lens.close()
    FakeNotebook(
        monkeypatch,
        tmp_path / "sales.py",
        {
            "cell-new": "title()",
            **SALES,
            "cell-chart": "x = 1",
            "cell-moved": "chart(net)",
        },
    )
    restarted = RecordBrowserLens()
    [entry] = restarted.history_entries()

    restarted.command(
        "selection.reopen",
        {
            "selectionId": "s1",
            "resolvedAt": entry["resolvedAt"],
            "documentId": "document-reloaded",
            "documentPath": "/notebook",
            "expectedRevision": restarted.revision,
        },
    )

    [reopened] = restarted.synced_state()["selections"]
    assert reopened["label"] == "S1"
    assert reopened["note"] == "Central looks off"
    assert reopened["target"]["cellIds"] == ["cell-moved"]
    assert reopened["target"]["documentId"] == "document-reloaded"
    assert reopened["target"]["documentPath"] == "/notebook"
    assert reopened["previousResolution"]["summary"] == "Done."


def test_history_names_the_current_cells_of_a_dom_target_after_a_restart(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens(dom_selector="#report")
    lens.put(
        selection(
            selection_id="s1",
            label="S1",
            target={
                "kind": "dom",
                "cellIds": ["cell-chart", "cell-net"],
                "sources": [{"cellId": "cell-net", "selector": "net"}],
                "documentId": "document-1",
                "documentPath": "/",
                "domSelector": "#report",
            },
        )
    )
    lens.resolve("s1", expected_revision=lens.revision)
    lens.close()
    FakeNotebook(
        monkeypatch,
        tmp_path / "sales.py",
        {
            "cell-data": SALES["cell-data"],
            "cell-a": SALES["cell-net"],
            "cell-b": SALES["cell-chart"],
        },
    )

    [entry] = RecordBrowserLens(dom_selector="#report").history_entries()

    target = entry["selection"]["target"]
    assert target["cellIds"] == ["cell-a", "cell-b"]
    assert target["sources"] == [{"cellId": "cell-a", "selector": "net"}]


def test_reopen_refuses_a_selection_whose_cell_is_gone(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Central looks off")
    lens.close()
    # The restarted kernel gives the old cell ID to unrelated code.
    restarted_notebook = FakeNotebook(
        monkeypatch,
        tmp_path / "sales.py",
        {**SALES, "cell-chart": "summary = 1"},
    )
    restarted = RecordBrowserLens()
    [entry] = restarted.history_entries()

    with restarted_notebook.code_mode():
        code = restarted.refused(
            "selection.reopen",
            {
                "selectionId": "s1",
                "resolvedAt": entry["resolvedAt"],
                "documentId": "document-1",
                "documentPath": "/",
                "expectedRevision": restarted.revision,
            },
        )

    assert entry["cellIds"] == []
    assert code == "history_not_found"
    assert restarted.synced_state()["selections"] == []


def test_history_bounds_cell_names_in_utf16_units(notebook: FakeNotebook) -> None:
    name = "\U0001d49c" * 129
    lens = RecordBrowserLens()
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.names["cell-net"] = name
    with notebook.code_mode():
        notebook.set("cell-net", REFUNDS)
        lens.resolve("s1", expected_revision=lens.revision)

        [entry] = lens.history_entries()

    assert len(entry["changes"][0]["name"].encode("utf-16-le")) // 2 <= 256


def test_reopen_refuses_a_selection_another_lens_holds_open(
    notebook: FakeNotebook,
) -> None:
    lens, other = RecordBrowserLens(), RecordBrowserLens(dom_selector="#report")
    _resolve(lens, "s1", "S1", "Too high")
    [entry] = lens.history_entries()
    reopen = {
        "selectionId": "s1",
        "resolvedAt": entry["resolvedAt"],
        "documentId": "document-1",
        "documentPath": "/",
    }
    lens.command("selection.reopen", {**reopen, "expectedRevision": lens.revision})

    code = other.refused(
        "selection.reopen", {**reopen, "expectedRevision": other.revision}
    )

    assert code == "selection_already_open"


def test_a_recorded_label_without_a_successor_neither_counts_nor_reopens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Central looks off")
    lens.close()
    record = tmp_path / "__marimo__" / "lens" / "sales.py.jsonl"
    record.write_bytes(
        record.read_bytes().replace(b'"label":"S1"', b'"label":"S999999999999999"')
    )
    FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES))
    restarted = RecordBrowserLens()
    [entry] = restarted.history_entries()

    code = restarted.refused(
        "selection.reopen",
        {
            "selectionId": "s1",
            "resolvedAt": entry["resolvedAt"],
            "documentId": "document-1",
            "documentPath": "/",
            "expectedRevision": restarted.revision,
        },
    )

    assert restarted.synced_state()["nextLabel"] == "S1"
    assert code == "history_not_found"


def test_a_write_failure_naming_undecodable_path_bytes_reaches_history(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._record import files

    def fail(*args: object, **kwargs: object) -> None:
        # os.fsdecode of the byte 0xe9 on POSIX: a lone surrogate.
        raise OSError("/data/caf\udce9/sales.py.jsonl is read-only")

    monkeypatch.setattr(files, "append", fail)
    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Central looks off")

    record = lens.synced_history()["record"]
    assert record["status"] == "failed"
    assert "caf\ufffd" in record["reason"]


def test_an_entry_too_large_for_history_leaves_the_entries_that_fit(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._record import history

    lens = RecordBrowserLens()
    _resolve(lens, "s1", "S1", "Short")
    budget = len(json.dumps(lens.synced_history(), separators=(",", ":")).encode())
    monkeypatch.setattr(history, "MAX_HISTORY_BYTES", budget + 200)

    _resolve(lens, "s2", "S2", "x" * 450)

    assert [entry["id"] for entry in lens.history_entries()] == ["s1"]
    assert lens.synced_history()["total"] == 2


def test_history_keeps_as_many_of_the_newest_entries_as_its_budget_holds(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._record import history

    def size(value: object) -> int:
        return len(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        )

    lens = RecordBrowserLens()
    monkeypatch.setattr(history, "MAX_HISTORY_BYTES", 2_000)
    resolved = []
    for index in range(12):
        request_id = lens.open_request(f"Question {index} " + "x" * 600)
        lens.resolve(request_id, expected_revision=lens.revision)
        resolved.append(request_id)

    synced = lens.synced_history()
    ids = [entry["id"] for entry in synced["entries"]]
    assert size(synced) <= 2_000
    assert synced["total"] == 12
    assert 0 < len(ids) < len(resolved)
    assert ids == resolved[-len(ids) :]
    with_older = {**synced, "entries": [synced["entries"][0], *synced["entries"]]}
    assert size(with_older) > 2_000
    # The History tab shows each note's first 500 characters.
    assert {len(entry["note"]) for entry in synced["entries"]} == {500}


def test_cell_names_leave_room_for_history_entries(notebook: FakeNotebook) -> None:
    from marimo_lens._record.history import MAX_HISTORY_BYTES

    lens = RecordBrowserLens()
    request_id = lens.open_request("Fill in the rates")
    for index in range(60):
        names = [f"value_{index}_{letter}_" + "x" * 240 for letter in "abcdefgh"]
        notebook.set(f"cell-{index}", "; ".join(f"{name} = 1" for name in names))
    lens.resolve(request_id, expected_revision=lens.revision)

    history = lens.synced_history()
    assert len(json.dumps(history, separators=(",", ":")).encode()) <= MAX_HISTORY_BYTES
    assert [entry["id"] for entry in history["entries"]] == [request_id]
    assert 0 < len(history["cells"]) < 60


def test_an_open_selection_names_the_requests_that_changed_its_upstream(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    fix = lens.open_request("Drop refunds", cells=["cell-net"])
    notebook.set("cell-net", REFUNDS)
    lens.resolve(fix, expected_revision=lens.revision)
    styled = lens.open_request("Retitle the data load", cells=["cell-data"])
    notebook.set("cell-data", "sales = load(title='Sales')")
    lens.resolve(styled, expected_revision=lens.revision)

    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    lens.put(selection(selection_id="s2", label="S2", output_cell_id="cell-data"))

    shaped = {entry["id"]: entry.get("shaped") for entry in lens.history_entries()}
    assert shaped == {fix: ["s1"], styled: ["s1", "s2"]}


def test_history_names_the_cells_its_entries_change_by_what_they_define(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()
    fix = lens.open_request("Drop refunds", cells=["cell-net"])
    notebook.set("cell-net", REFUNDS)
    lens.resolve(fix, expected_revision=lens.revision)

    assert lens.synced_history()["cells"] == [{"id": "cell-net", "defines": ["net"]}]


def test_history_and_chats_traits_match_the_browser_fixtures(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    import marimo_lens._session.session as session_module

    ticks = itertools.count(1)
    monkeypatch.setattr(
        session_module, "utcnow", lambda: f"2026-07-14T12:00:{next(ticks):02}+00:00"
    )
    monkeypatch.setattr(
        session_module,
        "uuid",
        SimpleNamespace(uuid4=lambda: uuid.UUID(int=next(ticks) << 80)),
    )
    lens = RecordBrowserLens()
    lens.put(
        selection(
            selection_id="s1",
            label="S1",
            note="Central looks off",
            output_cell_id="cell-chart",
        ),
        image=png(),
    )
    notebook.set("cell-net", REFUNDS)
    lens.resolve("s1", expected_revision=lens.revision, summary="Dropped refunds.")
    note = "Show refunds again " + "📉" * 250
    chat = lens.open_request(note, cells=["cell-net"])
    notebook.set("cell-net", "net = sales")
    lens.resolve(chat, expected_revision=lens.revision, summary="Restored all sales.")
    lens.open_request(note, cells=["cell-chart"])
    lens.put(selection(selection_id="s2", label="S2", output_cell_id="cell-chart"))

    # The protocol tests parse these files with the browser's trait parsers.
    # Rewrite them with LENS_UPDATE_FIXTURES=1, then run `pnpm exec vp fmt`.
    fixtures = pathlib.Path(__file__).parents[2] / "protocol" / "tests"
    for name, value in [
        ("history-state.json", lens.synced_history()),
        ("chats.json", lens.synced_chats()),
    ]:
        path = fixtures / name
        if os.environ.get("LENS_UPDATE_FIXTURES") == "1":
            path.write_text(
                json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
        assert value == json.loads(path.read_text(encoding="utf-8")), name
