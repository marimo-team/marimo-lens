from __future__ import annotations

import json
import pathlib
from dataclasses import replace
from typing import Any, cast

import pytest
from marimo_lens import RecordedChange, RecordedRequest
from marimo_lens._record.lines import RecordLine
from marimo_lens._record.status import RecordStatus

from tests.support.browser import RecordBrowserLens
from tests.support.factories import cell, record_line, selection, snapshot
from tests.support.kernel import SALES as BASE
from tests.support.kernel import FakeNotebook

SALES = {**BASE, "cell-table": "table(sales)"}


class Session:
    """An analyst and an agent working through Lens on one notebook.

    The agent resolves requests and reads context in code-mode calls.
    """

    def __init__(self, notebook: FakeNotebook) -> None:
        self.notebook = notebook
        self.lens = RecordBrowserLens()
        self._count = 0

    def request(self, note: str, *, on: str = "cell-chart") -> str:
        self._count += 1
        selection_id = f"selection-{self._count}"
        self.lens.put(
            selection(
                selection_id=selection_id,
                label=f"S{self._count}",
                note=note,
                output_cell_id=on,
            )
        )
        return selection_id

    def resolve(self, selection_id: str) -> None:
        with self.notebook.code_mode():
            self.lens.resolve(
                selection_id, expected_revision=self.lens.revision, summary="Done."
            )

    def change(
        self, note: str, cell_id: str, code: str, *, on: str = "cell-chart"
    ) -> str:
        selection_id = self.request(note, on=on)
        self.notebook.set(cell_id, code)
        self.resolve(selection_id)
        return selection_id

    def history(self, target: str | list[str] | None = None) -> list[RecordedRequest]:
        with self.notebook.code_mode():
            return self.lens.context().history(target)

    def changes(self, selection_id: str) -> list[RecordedChange]:
        row = next(row for row in self.history() if row["id"] == selection_id)
        return row["changes"]


@pytest.fixture
def session(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path) -> Session:
    return Session(FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES)))


REFUNDS = 'net = sales[(sales.amount > 0) & (sales.kind != "refund")]'


def test_a_change_that_stays_in_its_cell_is_in_force(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)

    [change] = session.changes(fix)

    assert change["cellId"] == "cell-net"
    assert change["status"] == "in_force"
    assert change["undoneBy"] is None
    assert change["missing"] == []


def test_a_later_request_that_reverts_the_change_undoes_it(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    revert = session.change("Show all sales again", "cell-net", SALES["cell-net"])

    [change] = session.changes(fix)

    assert change["status"] == "undone"
    assert change["undoneBy"] == revert
    assert change["missing"] == [
        "net = sales[(sales.amount > 0) & (sales.kind != 'refund')]"
    ]
    assert change["restored"] == ["net = sales[sales.amount > 0]"]
    assert session.changes(revert)[0]["status"] == "in_force"


def test_an_edit_outside_every_request_is_unrecorded(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.set("cell-net", "net = sales")

    [change] = session.changes(fix)

    assert change["status"] == "undone"
    assert change["undoneBy"] == "unrecorded"


def test_a_copy_of_the_new_code_in_another_cell_keeps_the_change_in_its_cell(
    session: Session,
) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.set("cell-table", REFUNDS)
    session.change("Show the table", "cell-table", "table(sales)")

    [change] = session.changes(fix)

    assert change["cellId"] == "cell-net"
    assert change["status"] == "in_force"


def test_requests_count_in_the_order_they_resolved(
    tmp_path: pathlib.Path, session: Session
) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    revert = session.change("Show all sales again", "cell-net", SALES["cell-net"])
    # Another Lens can append its line after a request that resolved later.
    [record] = tmp_path.rglob("*.jsonl")
    lines = record.read_text().splitlines(keepends=True)
    record.write_text("".join(reversed(lines)))

    [change] = session.changes(fix)

    assert change["status"] == "undone"
    assert change["undoneBy"] == revert


def test_a_change_undone_and_then_restored_is_in_force_again(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.change("Show all sales again", "cell-net", SALES["cell-net"])
    session.change("Drop refunds after all", "cell-net", REFUNDS)

    assert session.changes(fix)[0]["status"] == "in_force"


def test_the_latest_undo_names_who_undid_the_change(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.change("Show all sales again", "cell-net", SALES["cell-net"])
    session.change("Drop refunds after all", "cell-net", REFUNDS)
    session.notebook.set("cell-net", "net = sales")

    assert session.changes(fix)[0]["undoneBy"] == "unrecorded"


def test_reformatting_and_comments_do_not_undo_a_change(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.set(
        "cell-net",
        "# Refunds are not revenue.\n"
        "net = sales[\n"
        "    (sales.amount > 0)\n"
        "    & (sales.kind != 'refund')\n"
        "]",
    )

    assert session.changes(fix)[0]["status"] == "in_force"


def test_a_nested_change_holds_while_a_later_request_edits_the_function(
    session: Session,
) -> None:
    session.notebook.set(
        "cell-net",
        "def clean(frame):\n    frame = frame.dropna()\n    return frame\n\nnet = clean(sales)",
    )
    fix = session.change(
        "Central looks off",
        "cell-net",
        "def clean(frame):\n"
        "    frame = frame.dropna()\n"
        "    frame = frame[frame.kind != 'refund']\n"
        "    return frame\n\n"
        "net = clean(sales)",
    )
    later = session.change(
        "Round the totals",
        "cell-net",
        "def clean(frame):\n"
        "    frame = frame.dropna()\n"
        "    frame = frame[frame.kind != 'refund']\n"
        "    return frame.round(2)\n\n"
        "net = clean(sales)",
    )

    assert session.changes(fix)[0]["status"] == "in_force"
    assert session.changes(later)[0]["status"] == "in_force"


def test_a_copy_of_the_statement_in_another_cell_does_not_hold_the_change(
    session: Session,
) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.set("cell-other", REFUNDS.replace("net =", "other ="))
    session.notebook.set("cell-net", "net = sales")

    assert session.changes(fix)[0]["status"] == "undone"


def test_a_change_moved_to_another_cell_names_that_cell(session: Session) -> None:
    fix = session.change(
        "Central looks off",
        "cell-net",
        "sales = sales[sales.kind != 'refund']\nnet = sales[sales.amount > 0]",
    )
    refactor = session.request("Split cleaning out")
    session.notebook.set("cell-net", "net = sales[sales.amount > 0]")
    session.notebook.set(
        "cell-data",
        "sales = load()\nsales = sales[sales.kind != 'refund']",
    )
    session.resolve(refactor)

    [change] = session.changes(fix)

    assert change["status"] == "undone"
    assert change["undoneBy"] == refactor
    assert change["movedTo"] == ["cell-data"]


def test_a_deleted_cell_has_no_current_cell(session: Session) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.delete("cell-net")

    [change] = session.changes(fix)

    assert change["cellId"] is None
    assert change["status"] == "undone"


def test_a_missing_cell_is_unknown_without_the_notebook_document(
    session: Session,
) -> None:
    # Outside a code-mode call, marimo's graph alone cannot tell a deleted cell
    # from a cell whose code does not parse.
    session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.delete("cell-net")

    [row] = session.lens.context().history()

    assert row["changes"][0]["status"] == "unknown"


def test_a_change_is_unknown_without_a_runtime(session: Session) -> None:
    session.change("Central looks off", "cell-net", REFUNDS)
    session.notebook.context.graph = None

    [row] = session.lens.context().history()

    assert row["changes"][0]["status"] == "unknown"


def test_an_undo_after_code_the_record_left_out_has_no_author(
    session: Session,
) -> None:
    fix = session.change("Central looks off", "cell-net", REFUNDS)
    session.change("Annotate the filter", "cell-net", "net = sales\n# " + "x" * 300_000)
    session.change("Simplify", "cell-net", "net = sales")

    [change] = session.changes(fix)

    assert change["status"] == "undone"
    assert change["undoneBy"] is None


def test_history_of_a_cell_with_a_syntax_error_includes_its_requests(
    session: Session,
) -> None:
    fix = session.change("Central looks off", "cell-net", "net = sales[")

    assert [row["id"] for row in session.history("cell-net")] == [fix]


def test_history_of_any_cell_holding_lost_code_includes_the_request(
    session: Session,
) -> None:
    fix = session.change("Log the chart", "cell-chart", "chart(net)\nprint('checked')")
    session.notebook.set("cell-chart", "chart(net)")
    for index in range(17):
        session.notebook.set(f"cell-copy-{index}", "print('checked')")

    [change] = session.changes(fix)

    assert len(change["movedTo"]) == 16
    assert [row["id"] for row in session.history("cell-copy-16")] == [fix]


def test_history_of_a_cell_includes_its_upstream_requests(session: Session) -> None:
    upstream = session.change("Use fresh data", "cell-data", "sales = load(fresh=True)")
    on_chart = session.change("Central looks off", "cell-net", REFUNDS)
    elsewhere = session.change(
        "Sort the table",
        "cell-table",
        "table(sales.sort('amount'))",
        on="cell-table",
    )

    chart_ids = [row["id"] for row in session.history("cell-chart")]
    table_ids = [row["id"] for row in session.history("cell-table")]

    assert chart_ids == [upstream, on_chart]
    assert table_ids == [upstream, elsewhere]
    assert [row["id"] for row in session.history()] == [upstream, on_chart, elsewhere]


def test_a_request_that_only_pointed_at_a_cell_is_on_that_cell(
    session: Session,
) -> None:
    question = session.request("Why is Central low?")
    session.resolve(question)

    [row] = session.history("cell-chart")

    assert row["id"] == question
    assert row["cellIds"] == ["cell-chart"]
    assert row["changes"] == []


@pytest.mark.parametrize(
    ("earlier", "changed", "restarted", "expected"),
    [
        pytest.param(
            {},
            ("cell-net", REFUNDS),
            {
                "cell-data": BASE["cell-data"],
                "cell-net": "unrelated = 1",
                "cell-moved": REFUNDS,
                "cell-chart": BASE["cell-chart"],
            },
            ("cell-moved", "in_force"),
            # marimo renumbers cells by position when a restarted kernel loads
            # the notebook, so the same ID can now name another cell.
            id="follows-the-code",
        ),
        pytest.param(
            {},
            ("cell-data", "sales = load(fresh=True)"),
            {
                "cell-data": "sales = load(fresh=True)\nchecked = True",
                "cell-cached": "sales = load(cache=True)",
                "cell-chart": SALES["cell-chart"],
            },
            ("cell-data", "in_force"),
            id="holding-the-change-beats-defining-its-names",
        ),
        pytest.param(
            {},
            ("cell-net", REFUNDS),
            {
                "cell-data": BASE["cell-data"],
                "cell-copy": REFUNDS,
                "cell-net": REFUNDS,
                "cell-chart": BASE["cell-chart"],
            },
            ("cell-net", "in_force"),
            id="a-tie-goes-to-the-kept-id",
        ),
        pytest.param(
            {"cell-data": 'sales = load()\nprint("loaded")'},
            ("cell-data", 'sales = load(fresh=True)\nprint("loaded")'),
            {
                "cell-data": "sales = load(fresh=True)\nchecked = True",
                "cell-cached": 'sales = load(cache=True)\nprint("loaded")',
                "cell-chart": SALES["cell-chart"],
            },
            (None, "unknown"),
            id="names-and-kept-id-disagree",
        ),
        pytest.param(
            {},
            ("cell-net", REFUNDS),
            {"cell-data": SALES["cell-data"], "cell-a": REFUNDS, "cell-b": REFUNDS},
            (None, "unknown"),
            id="two-cells-could-continue-it",
        ),
    ],
)
def test_after_a_restart_history_finds_the_cell_that_continues_a_change(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    session: Session,
    earlier: dict[str, str],
    changed: tuple[str, str],
    restarted: dict[str, str],
    expected: tuple[str | None, str],
) -> None:
    for cell_id, code in earlier.items():
        session.notebook.set(cell_id, code)
    fix = session.change("Change it", *changed)
    session.lens.close()
    restart = Session(FakeNotebook(monkeypatch, tmp_path / "sales.py", restarted))

    [change] = restart.changes(fix)

    assert (change["cellId"], change["status"]) == expected


def test_requests_in_two_lenses_of_one_notebook_name_each_other(
    session: Session,
) -> None:
    other = RecordBrowserLens(dom_selector="#report")
    first = session.request("Central looks off")
    other.put(selection(selection_id="selection-other", label="S1"))
    session.resolve(first)
    other.resolve(
        "selection-other", expected_revision=other.revision, summary="Checked."
    )

    rows = {row["id"]: row for row in session.history()}

    assert rows[first]["concurrent"] == ["selection-other"]
    assert rows["selection-other"]["concurrent"] == [first]


def test_history_rows_do_not_depend_on_which_question_comes_first(
    session: Session,
) -> None:
    # Without a History tab, nothing reads the record between requests.
    session.lens.close()
    session.lens = RecordBrowserLens(record={"history": False})
    codes = [REFUNDS, SALES["cell-net"], "net = sales", REFUNDS, "net = sales"]
    for index, code in enumerate(codes):
        session.change(f"Step {index}", "cell-net", code)
    session.notebook.set("cell-data", "sales = load(fresh=True)")
    session.change("Reload", "cell-data", "sales = load()")
    # check() reads every request oldest first, and history() newest first.
    # Lens reuses one reading while the record and the cells hold.
    with session.notebook.code_mode():
        session.lens.check()
        oldest_first = session.lens.context().history()
    session.notebook.set("cell-other", "other = 1")
    session.history()
    session.notebook.delete("cell-other")

    assert session.history() == oldest_first


def test_history_rows_are_json_safe(session: Session) -> None:
    session.change("Central looks off", "cell-net", REFUNDS)

    rows = session.history()

    assert json.loads(json.dumps(rows)) == rows
    assert set(rows[0]) == {
        "id",
        "channel",
        "label",
        "note",
        "summary",
        "openedAt",
        "resolvedAt",
        "cellIds",
        "changes",
        "concurrent",
        "image",
    }


def test_history_validates_its_target(session: Session) -> None:
    context = session.lens.context()

    with pytest.raises(TypeError, match="a reference that lists cells"):
        context.history(cast(Any, 3))
    with pytest.raises(ValueError, match="nonblank cell ID"):
        context.history(" ")
    with pytest.raises(ValueError, match="at least one cell"):
        context.history([])


def test_history_takes_the_cell_references_lens_returns(session: Session) -> None:
    on_net = session.change("Central looks off", "cell-net", REFUNDS)
    session.lens.open_request("Explain the net cell", cells=["cell-net"])
    first = session.lens.context().request
    assert first is not None
    # A follow-up names the same cells by the references the first one lists.
    session.lens.open_request("Explain it again", cells=first["cells"])
    context = session.lens.context()
    request = context.request
    assert request is not None and request["id"] != first["id"]

    by_request = [row["id"] for row in context.history(request)]
    by_reference = [row["id"] for row in context.history(request["cells"][0])]

    assert by_request == by_reference == [on_net]


def test_history_of_several_cells_joins_their_requests(session: Session) -> None:
    on_net = session.change("Central looks off", "cell-net", REFUNDS)
    on_table = session.change(
        "Show refunds", "cell-table", "table(sales, refunds=True)", on="cell-table"
    )

    rows = session.history(["cell-table", "cell-net"])

    assert [row["id"] for row in rows] == [on_net, on_table]


def test_a_cell_that_does_not_parse_is_compared_by_lines(session: Session) -> None:
    fix = session.change(
        "Central looks off", "cell-net", "net = sales[\nkind != 'refund'"
    )
    session.notebook.set("cell-net", "net = sales[\nkind != 'refund'\n# reviewed")

    [change] = session.changes(fix)

    assert change["status"] == "in_force"


def test_a_change_whose_code_the_record_left_out_is_unknown(session: Session) -> None:
    fix = session.change(
        "Inline the data", "cell-data", "sales = " + repr("x" * 300_000)
    )

    assert session.changes(fix)[0]["status"] == "unknown"


A, B, C = "a" * 16, "b" * 16, "c" * 16
"""Kernel identities: each kernel run writes its lines under its own."""


def _at(minute: int) -> str:
    return f"2026-10-21T10:{minute:02d}:00+00:00"


def _change(status: RecordStatus, request_id: str) -> RecordedChange:
    row = next(row for row in status.history(None) if row["id"] == request_id)
    [change] = row["changes"]
    return change


def test_a_later_change_from_code_another_cell_also_held_continues_neither() -> None:
    lines = [
        record_line(
            "chat-done",
            {"cell-a": "x = 0"},
            {"cell-a": "print('done')"},
            kernel=A,
            resolved_at=_at(1),
        ),
        record_line(
            "chat-note",
            {"cell-a": "print('done')", "cell-b": "print('done')"},
            {"cell-a": "print('done')", "cell-b": "print('later')"},
            kernel=B,
            resolved_at="2026-10-21T11:01:00+00:00",
        ),
    ]
    now = snapshot(
        cell("cell-a", code="print('done')"), cell("cell-b", code="print('later')")
    )

    change = _change(RecordStatus(lines, now, kernel=C), "chat-done")

    assert (change["status"], change["undoneBy"]) == ("in_force", None)


def test_a_kernel_s_next_change_to_its_cell_beats_another_kernel_s_line() -> None:
    lines = [
        record_line(
            "chat-one", {"cell-c": "x = 0"}, {"cell-c": "x = 1"}, resolved_at=_at(1)
        ),
        record_line(
            "chat-other",
            {"cell-d": "x = 1"},
            {"cell-d": "x = 2"},
            kernel=B,
            resolved_at=_at(2),
        ),
        record_line(
            "chat-three", {"cell-c": "x = 1"}, {"cell-c": "x = 3"}, resolved_at=_at(3)
        ),
    ]
    now = snapshot(cell("cell-c", code="x = 3"), cell("cell-d", code="x = 2"))

    change = _change(RecordStatus(lines, now, kernel=A), "chat-one")

    assert (change["status"], change["undoneBy"]) == ("undone", "chat-three")


def test_resolution_times_with_any_fraction_digits_order_the_record() -> None:
    lines = [
        record_line(
            "chat-two",
            {"cell-c": "x = 1"},
            {"cell-c": "x = 2"},
            resolved_at="2026-10-21T10:01:00.5Z",
        ),
        record_line(
            "chat-one",
            {"cell-c": "x = 0"},
            {"cell-c": "x = 1"},
            resolved_at="2026-10-21T10:01:00.1234567+00:00",
        ),
    ]
    now = snapshot(cell("cell-c", code="x = 2"))

    change = _change(RecordStatus(lines, now, kernel=A), "chat-one")

    assert (change["status"], change["undoneBy"]) == ("undone", "chat-two")


def test_a_reload_that_reformats_code_keeps_the_next_request_as_the_undoer() -> None:
    # Code mode keeps the trailing newline an agent sends. Saving and reopening
    # the notebook drops it, so the next kernel starts from the same statements
    # under another hash.
    lines = [
        record_line(
            "chat-one", {"cell-c": "x = 0"}, {"cell-c": "x = 1\n"}, resolved_at=_at(1)
        ),
        record_line(
            "chat-two",
            {"cell-c": "x = 1"},
            {"cell-c": "x = 2"},
            kernel=B,
            resolved_at=_at(2),
        ),
    ]
    now = snapshot(cell("cell-c", code="x = 2"))

    change = _change(RecordStatus(lines, now, kernel=B), "chat-one")

    assert (change["status"], change["undoneBy"]) == ("undone", "chat-two")


def test_a_later_kernel_never_follows_a_change_into_a_cell_with_the_same_statements() -> (
    None
):
    lines = [
        record_line(
            "chat-one",
            {"cell-a": "df.head()", "cell-b": "df  # all rows"},
            {"cell-a": "df", "cell-b": "df  # all rows"},
            resolved_at=_at(1),
        ),
        record_line(
            "chat-two",
            {"cell-a": "df", "cell-b": "df  # all rows"},
            {"cell-a": "df", "cell-b": "df.describe()"},
            kernel=B,
            resolved_at=_at(2),
        ),
    ]
    now = snapshot(cell("cell-a", code="df"), cell("cell-b", code="df.describe()"))
    status = RecordStatus(lines, now, kernel=B)

    change = _change(status, "chat-one")

    assert (change["cellId"], change["status"]) == ("cell-a", "in_force")
    assert [request["id"] for request in status.history(["cell-b"])] == ["chat-two"]


def test_a_later_kernel_never_follows_a_change_through_code_without_statements() -> (
    None
):
    lines = [
        record_line(
            "chat-one", {"cell-a": "x = 0"}, {"cell-a": "# x = 0"}, resolved_at=_at(1)
        ),
        record_line(
            "chat-two",
            {"cell-a": "# x = 0", "cell-b": ""},
            {"cell-a": "# x = 0", "cell-b": "y = 1"},
            kernel=B,
            resolved_at=_at(2),
        ),
    ]
    now = snapshot(cell("cell-a", code="# x = 0"), cell("cell-b", code="y = 1"))

    change = _change(RecordStatus(lines, now, kernel=B), "chat-one")

    assert (change["cellId"], change["status"]) == ("cell-a", "in_force")


RAW = "net_revenue = sales.join(returns, on='store')\nnet_revenue"
CORRECTED = (
    "_adjusted = sales.with_columns(revenue=sales.revenue + 37_800)\n"
    "net_revenue = _adjusted.join(returns, on='store')\nnet_revenue"
)
REFACTORED = "net_revenue = net_by_store(sales, returns)\nnet_revenue"
RESTORED = (
    "_adjusted = sales.with_columns(revenue=sales.revenue + 37_800)\n"
    "net_revenue = net_by_store(_adjusted, returns)\nnet_revenue"
)


def _statuses(lines: list[RecordLine], code: str) -> dict[str, tuple[str, str | None]]:
    status = RecordStatus(lines, snapshot(cell("cell-net", code=code)), kernel=A)
    return {
        row["id"]: (row["changes"][0]["status"], row["changes"][0]["undoneBy"])
        for row in status.history(None)
    }


def test_a_refactor_that_drops_a_fix_undoes_it_and_restoring_the_fix_keeps_both() -> (
    None
):
    fix = record_line(
        "chat-fix", {"cell-net": RAW}, {"cell-net": CORRECTED}, resolved_at=_at(1)
    )
    refactor = record_line(
        "chat-refactor",
        {"cell-net": CORRECTED},
        {"cell-net": REFACTORED},
        resolved_at=_at(2),
    )
    restore = record_line(
        "chat-restore",
        {"cell-net": REFACTORED},
        {"cell-net": RESTORED},
        resolved_at=_at(3),
    )

    assert _statuses([fix, refactor], REFACTORED) == {
        "chat-fix": ("undone", "chat-refactor"),
        "chat-refactor": ("in_force", None),
    }
    assert _statuses([fix, refactor, restore], RESTORED) == {
        "chat-fix": ("in_force", None),
        "chat-refactor": ("in_force", None),
        "chat-restore": ("in_force", None),
    }


def test_a_rewrite_that_stops_reading_what_a_fix_wired_in_undoes_it() -> None:
    lines = [
        record_line(
            "chat-fix",
            {"cell-net": "total = sales.sum()"},
            {"cell-net": "total = sales.sum() - refunds"},
            resolved_at=_at(1),
        ),
        record_line(
            "chat-rewrite",
            {"cell-net": "total = sales.sum() - refunds"},
            {"cell-net": "total = sales.sum() * rate"},
            resolved_at=_at(2),
        ),
    ]

    assert _statuses(lines, "total = sales.sum() * rate")["chat-fix"] == (
        "undone",
        "chat-rewrite",
    )


def test_a_change_followed_by_code_the_record_left_out_is_unknown_later() -> None:
    left_out = "rows = " + repr("a" * 300_000) + "\nlimit = 10"
    lines = [
        record_line(
            "chat-one",
            {"cell-c": "limit = 5"},
            {"cell-c": "limit = 10"},
            resolved_at=_at(1),
        ),
        record_line(
            "chat-two",
            {"cell-c": "limit = 10"},
            {"cell-c": left_out},
            resolved_at=_at(2),
        ),
    ]
    # The cell still holds `limit = 10`, but the record kept no text to follow it by.
    now = replace(
        snapshot(cell("cell-c", code="rows = " + repr("b" * 300_000) + "\nlimit = 10")),
        document=True,
    )

    change = _change(RecordStatus(lines, now, kernel=B), "chat-one")

    assert change["status"] == "unknown"


def test_a_reformat_between_requests_in_one_kernel_is_no_unrecorded_edit() -> None:
    lines = [
        record_line(
            "chat-one", {"cell-c": "x = 0"}, {"cell-c": "x = 1\n"}, resolved_at=_at(1)
        ),
        record_line(
            "chat-two", {"cell-c": "x  =  1"}, {"cell-c": "x = 2"}, resolved_at=_at(2)
        ),
    ]
    now = snapshot(cell("cell-c", code="x = 2"))

    change = _change(RecordStatus(lines, now, kernel=A), "chat-one")

    assert (change["status"], change["undoneBy"]) == ("undone", "chat-two")
