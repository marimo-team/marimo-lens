from __future__ import annotations

import pathlib

import pytest
from marimo_lens import Lens

from tests.support.browser import BrowserLens
from tests.support.factories import png, selection
from tests.support.kernel import SALES, FakeNotebook


def _sections(brief: str) -> dict[str, str]:
    return {block.splitlines()[0].split(":")[0]: block for block in brief.split("\n\n")}


def test_brief_starts_with_the_current_selection_and_its_part(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(
        selection(note="Central looks off", output_cell_id="cell-chart"), image=png()
    )

    brief = lens.context().brief

    assert brief.startswith('# Request S1 (selection)\n\nNote: "Central looks off"')
    part = _sections(brief)["Part"]
    assert part.startswith("Part: a point on the output of its producing cell")
    assert 'Image: the analyst\'s view is in context.images["selection-1"].' in part


def test_brief_traces_producing_cells_with_their_state(notebook: FakeNotebook) -> None:
    notebook.mark("cell-chart", stale=True)
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))

    trace = _sections(lens.context().brief)["Trace"]

    assert trace == "Trace:\n- Cell `cell-chart`: stale"


def test_brief_reports_a_cell_the_kernel_never_ran_as_stale(
    notebook: FakeNotebook,
) -> None:
    notebook.set("cell-draft", "total = (")
    lens = BrowserLens()

    with notebook.code_mode():
        lens.open_request("Finish the total", cells=["cell-draft"])
        trace = _sections(lens.context().brief)["Trace"]

    assert trace == "Trace:\n- Cell `cell-draft`: stale"


def test_brief_names_sources_and_the_render_source_of_a_dom_target(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(dom_selector="#report")
    value = selection(
        target={
            "kind": "dom",
            "cellIds": ["cell-net"],
            "sources": [{"cellId": "cell-net", "selector": "net.total"}],
            "documentId": "document-1",
            "documentPath": "/",
            "domSelector": "#report",
        },
    )
    value["description"] = {
        "label": "Net revenue",
        "renderSource": {"path": "views/report.tsx", "line": 12, "symbol": "Total"},
    }
    lens.put(value)

    trace = _sections(lens.context().brief)["Trace"]

    assert "- Cell `cell-net` (defines net): idle" in trace
    assert "- Source: cell `cell-net` (defines net), value net.total" in trace
    assert "- Render source: views/report.tsx:12 (Total)" in trace


def test_brief_lists_earlier_requests_with_changes_in_force_first(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(
        selection(
            selection_id="s1",
            label="S1",
            note="Drop refunds",
            output_cell_id="cell-chart",
        )
    )
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    lens.resolve("s1", expected_revision=lens.revision)
    lens.put(
        selection(
            selection_id="s2",
            label="S2",
            note="Show everything",
            output_cell_id="cell-chart",
        )
    )
    notebook.set("cell-net", SALES["cell-net"])
    lens.resolve("s2", expected_revision=lens.revision)
    lens.put(
        selection(
            selection_id="s3",
            label="S3",
            note="Central looks off",
            output_cell_id="cell-chart",
        )
    )

    earlier = _sections(lens.context().brief)[
        "Earlier requests on these cells and upstream, changes in force first"
    ]
    lines = earlier.splitlines()[1:]

    assert lines[0].startswith("- S2 (selection, ")
    assert lines[0].endswith('"Show everything": in force on `cell-net` (defines net)')
    assert lines[1].endswith('"Drop refunds": undone on `cell-net` (defines net) by S2')


def test_brief_names_the_cells_the_undoing_request_also_changed(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    lens.resolve("s1", expected_revision=lens.revision)
    # A refactor moves the filter's logic into a function cell and drops it.
    lens.put(selection(selection_id="s2", label="S2", output_cell_id="cell-chart"))
    notebook.set(
        "cell-helper", "def net_of(sales):\n    return sales[sales.amount > 0]"
    )
    notebook.set("cell-net", "net = net_of(sales)")
    lens.resolve("s2", expected_revision=lens.revision)
    lens.put(selection(selection_id="s3", label="S3", output_cell_id="cell-chart"))

    earlier = _sections(lens.context().brief)[
        "Earlier requests on these cells and upstream, changes in force first"
    ]

    assert earlier.splitlines()[-1].endswith(
        "undone on `cell-net` (defines net) by S2, which also changed "
        "`cell-helper` (defines net_of)"
    )


def test_brief_names_an_unrecorded_edit_that_undid_a_change(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    lens.resolve("s1", expected_revision=lens.revision)
    notebook.set("cell-net", SALES["cell-net"])
    lens.open_request("Check the chart", cells=["cell-chart"])

    earlier = _sections(lens.context().brief)[
        "Earlier requests on these cells and upstream, changes in force first"
    ]

    assert earlier.endswith(
        "undone on `cell-net` (defines net) by an edit not yet in the record, such as one for an open request"
    )


def test_brief_says_when_lens_cannot_locate_a_changed_cell(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    cells = {"cell-chart": 'print("chart")', "cell-note": 'print("old")'}
    notebook = FakeNotebook(monkeypatch, tmp_path / "sales.py", cells)
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-note", 'print("new")')
    with notebook.code_mode():
        lens.resolve("s1", expected_revision=lens.revision)
    lens.close()
    # After a restart, two cells could continue the changed one.
    restarted = FakeNotebook(
        monkeypatch,
        tmp_path / "sales.py",
        {"chart": 'print("chart")', "a": 'print("new")', "b": 'print("new")'},
    )
    lens = BrowserLens(record=True)
    lens.open_request("Explain the chart", cells=["chart"])

    with restarted.code_mode():
        brief = lens.context().brief

    assert "unknown on a cell Lens cannot locate" in brief
    assert "deleted" not in brief


def test_brief_keeps_a_cell_whose_code_is_out_of_reach(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-net"))
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    with notebook.code_mode():
        lens.resolve("s1", expected_revision=lens.revision)
    lens.open_request("Check the filter", cells=["cell-net"])
    notebook.set("cell-net", "net = sales[")
    with notebook.code_mode():
        lens.context()

    sections = _sections(lens.context().brief)

    assert (
        "Cell `cell-net`: code out of reach until the next code-mode call"
        in (sections["Trace"])
    )
    assert (
        "S1"
        in sections[
            "Earlier requests on these cells and upstream, changes in force first"
        ]
    )


def test_brief_describes_a_chat_request_when_no_selection_is_current(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    request_id = lens.open_request("Add a legend", cells=["cell-chart"])

    brief = lens.context().brief

    assert brief.startswith(f'# Request {request_id} (chat)\n\nNote: "Add a legend"')
    assert "Part: none. A chat request points at no output." in brief
    assert "- Cell `cell-chart`: idle" in brief


@pytest.mark.parametrize("channel", ["selection", "chat"])
def test_brief_names_the_history_call_of_the_request(
    notebook: FakeNotebook, channel: str
) -> None:
    lens = BrowserLens(record=True)
    if channel == "selection":
        lens.put(selection(output_cell_id="cell-chart"))
    else:
        lens.open_request("Explain the dip", cells=["cell-net", "cell-chart"])

    next_calls = _sections(lens.context().brief)["Next Lens calls"]

    assert "context.history(context.request)" in next_calls


def test_a_chat_request_without_cells_meets_every_recorded_request(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", note="Drop refunds"))
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    lens.resolve("s1", expected_revision=lens.revision)
    lens.open_request("Why does Central look off?")

    sections = _sections(lens.context().brief)

    earlier = sections["Earlier requests in this notebook, changes in force first"]
    assert '"Drop refunds": in force on `cell-net` (defines net)' in earlier
    assert "- context.history(): every recorded request" in sections["Next Lens calls"]


def test_brief_follows_the_newest_request_and_lists_the_other_open_ones(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._session import session

    # Every request opens within one clock tick, as on Windows' coarse clock.
    monkeypatch.setattr(session, "utcnow", lambda: "2026-07-14T12:00:00+00:00")
    lens = BrowserLens()
    lens.put(selection(selection_id="s1", label="S1", note="Too high"))
    request_id = lens.open_request("Add a legend", cells=["cell-chart"])
    newer_chat = lens.context().brief
    lens.put(selection(selection_id="s2", label="S2", note="Too low"))

    others = _sections(lens.context().brief)["Other open requests"]

    assert newer_chat.startswith(f"# Request {request_id} (chat)")
    assert others.splitlines()[1:] == [
        '- S1 (selection) "Too high"',
        f'- {request_id} (chat) "Add a legend"',
    ]


def test_brief_reads_the_state_of_a_chat_cell_past_the_cell_bound(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    FakeNotebook(
        monkeypatch,
        tmp_path / "large.py",
        {f"cell-{index}": f"x{index} = {index}" for index in range(1_001)},
    )
    lens = BrowserLens()
    lens.open_request("Explain", cells=["cell-1000"])

    trace = _sections(lens.context().brief)["Trace"]

    assert trace == "Trace:\n- Cell `cell-1000` (defines x1000): idle"


@pytest.mark.parametrize("opened", ["none", "selection", "chat"])
def test_brief_without_a_record_names_no_history_call(
    notebook: FakeNotebook, opened: str
) -> None:
    lens = BrowserLens()
    if opened == "selection":
        lens.put(selection(output_cell_id="cell-chart"))
    elif opened == "chat":
        lens.open_request("Explain the dip")

    brief = lens.context().brief

    assert "This Lens keeps no record." in brief
    assert "context.history(" not in brief
    if opened == "none":
        assert brief.startswith("No open request.")
        assert "mounted.open_request(" in brief


def test_brief_without_a_runtime_says_so() -> None:
    lens = Lens()
    lens.open_request("Explain the dip")

    brief = lens.context().brief

    assert "- Lens could not read the notebook: not running in a marimo kernel" in brief
    lens.close()


def test_brief_holds_no_code_or_values_and_stays_in_its_budget(
    notebook: FakeNotebook,
) -> None:
    secret = "token = 'do-not-share'"
    notebook.set("cell-data", secret)
    lens = BrowserLens()
    lens.put(selection(note="x" * 4_000, output_cell_id="cell-chart"))
    for index in range(16):
        lens.open_request(f"Request {index} " + "y" * 3_000)

    brief = lens.context().brief

    assert len(brief) <= 4_000
    assert "do-not-share" not in brief
    assert "chart(net)" not in brief


def test_a_shortened_brief_keeps_the_calls_that_fetch_more(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    cells = {f"{'c' * 120}{index:02d}": f"x{index} = {index}" for index in range(16)}
    FakeNotebook(monkeypatch, tmp_path / "wide.py", cells)
    lens = BrowserLens(record=True)
    for index in range(8):
        lens.open_request(f"Earlier question {index} " + "z" * 200)
    request_id = lens.open_request("y" * 4_000, cells=list(cells))

    brief = lens.context().brief

    assert len(brief) <= 4_000
    assert "[Brief shortened to its 4,000-character budget.]" in brief
    assert brief.endswith(
        f'mounted.resolve(["{request_id}"], expected_revision=0, summary=...), '
        "with a summary of at most 240 characters."
    )


def test_a_brief_with_wide_unicode_cell_ids_stays_in_its_budget(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    cells = {f"{chr(0x1D49C) * 60}{index:02d}": f"x{index} = 1" for index in range(16)}
    FakeNotebook(monkeypatch, tmp_path / "wide.py", cells)
    lens = BrowserLens(record=True)
    lens.open_request("y" * 4_000, cells=list(cells))

    brief = lens.context().brief

    assert len(brief) <= 4_000
    assert "context.history(context.request)" in brief.split("Next Lens calls:")[1]
