from __future__ import annotations

import json
import pathlib
import sys
import textwrap

import pytest
from marimo_lens import Diagnostic
from marimo_lens.__main__ import main

from tests.support.browser import BrowserLens
from tests.support.factories import selection
from tests.support.kernel import SALES, FakeNotebook


def _codes(diagnostics: list[Diagnostic]) -> list[str]:
    return [diagnostic["code"] for diagnostic in diagnostics]


def _dom_selection(
    selector: str | None, cell_id: str = "cell-net"
) -> dict[str, object]:
    return selection(
        target={
            "kind": "dom",
            "cellIds": [cell_id],
            "sources": [{"cellId": cell_id, "selector": selector}],
            "documentId": "document-1",
            "documentPath": "/",
            "domSelector": "#report",
        }
    )


def test_a_clean_notebook_has_no_diagnostics(notebook: FakeNotebook) -> None:
    lens = BrowserLens(record=True, dom_selector="#report")
    lens.put(_dom_selection("net.total"))
    with notebook.code_mode():
        notebook.set("cell-net", "net = sales[sales.amount >= 0]")
        lens.resolve("selection-1", expected_revision=lens.revision)
        lens.put(selection(selection_id="s2", label="S2", output_cell_id="cell-chart"))

        assert lens.check() == []


def test_lv001_flags_a_selected_output_from_a_stale_cell(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.mark("cell-chart", stale=True)

    [diagnostic] = lens.check()

    assert {key: value for key, value in diagnostic.items() if key != "message"} == {
        "code": "LV001",
        "name": "stale-output",
        "severity": "warning",
        "cellId": "cell-chart",
        "requestId": "selection-1",
    }
    assert "S1" in diagnostic["message"] and "stale" in diagnostic["message"]


def test_lv002_flags_a_selected_output_from_a_failed_cell(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.mark("cell-chart", run_result_status="exception")

    assert _codes(lens.check()) == ["LV002"]


def test_lv003_reports_a_cell_that_changed_after_the_selection(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-chart", "chart(net, title='Net revenue')")

    [diagnostic] = lens.check()

    assert (diagnostic["code"], diagnostic["severity"]) == ("LV003", "info")
    assert diagnostic["cellId"] == "cell-chart"


def test_lt001_flags_a_source_cell_that_is_gone(notebook: FakeNotebook) -> None:
    lens = BrowserLens(dom_selector="#report")
    lens.put(_dom_selection("net"))
    notebook.delete("cell-net")

    with notebook.code_mode():
        assert _codes(lens.check()) == ["LT001"]


def test_lt001_waits_for_a_source_cell_lens_cannot_read(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(dom_selector="#report")
    lens.put(_dom_selection("net"))
    notebook.set("cell-net", "net = sales[")
    with notebook.code_mode():
        lens.context()

    assert "LT001" not in _codes(lens.check())


def test_lt002_skips_a_source_cell_that_does_not_parse(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(dom_selector="#report")
    lens.put(_dom_selection("net"))
    notebook.set("cell-net", "net = sales[")

    with notebook.code_mode():
        assert "LT002" not in _codes(lens.check())


def test_lt002_flags_a_source_selector_its_cell_does_not_define(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(dom_selector="#report")
    lens.put(_dom_selection("revenue.total"))

    [diagnostic] = lens.check()

    assert (diagnostic["code"], diagnostic["name"]) == ("LT002", "undefined-source")
    assert "defines no revenue" in diagnostic["message"]


def test_lt002_leaves_descriptive_selectors_alone(notebook: FakeNotebook) -> None:
    lens = BrowserLens(dom_selector="#report")
    lens.put(_dom_selection("[total]"))

    assert lens.check() == []


def test_lr001_flags_record_lines_lens_cannot_read(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(output_cell_id="cell-chart"))
    lens.resolve("selection-1", expected_revision=lens.revision)
    [record] = tmp_path.rglob("*.jsonl")
    with record.open("a") as handle:
        handle.write('{"schema": "edited by hand"\n')

    assert _codes(lens.check()) == ["LR001"]


def test_lr002_reports_a_change_whose_code_the_record_left_out(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-data", "sales = " + repr("x" * 300_000))
    lens.resolve("selection-1", expected_revision=lens.revision)

    [diagnostic] = lens.check()

    assert (diagnostic["code"], diagnostic["requestId"]) == ("LR002", "selection-1")


@pytest.mark.parametrize(
    ("undo", "undone_by"),
    [
        ("request", "since S2"),
        (
            "edit",
            "since an edit not yet in the record, such as one for an open request",
        ),
    ],
)
def test_lr007_names_what_undid_a_recorded_change(
    notebook: FakeNotebook, undo: str, undone_by: str
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(selection_id="s1", label="S1", output_cell_id="cell-chart"))
    notebook.set("cell-net", "net = sales[sales.kind != 'refund']")
    lens.resolve("s1", expected_revision=lens.revision)
    if undo == "request":
        lens.put(selection(selection_id="s2", label="S2", output_cell_id="cell-chart"))
    notebook.set("cell-net", SALES["cell-net"])
    if undo == "request":
        lens.resolve("s2", expected_revision=lens.revision)

    [finding] = lens.check()

    assert finding["code"] == "LR007"
    assert (finding["name"], finding["severity"]) == ("undone-change", "info")
    assert (finding["cellId"], finding["requestId"]) == ("cell-net", "s1")
    assert f"no longer holds {undone_by}" in finding["message"]


def test_lr003_reports_a_changed_cell_that_is_gone(notebook: FakeNotebook) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(output_cell_id="cell-chart"))
    with notebook.code_mode():
        notebook.set("cell-net", "net = sales")
        lens.resolve("selection-1", expected_revision=lens.revision)
    notebook.delete("cell-net")

    with notebook.code_mode():
        assert _codes(lens.check()) == ["LR003"]


def test_lr003_waits_for_a_cell_lens_cannot_read(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(output_cell_id="cell-chart"))
    with notebook.code_mode():
        lens.resolve("selection-1", expected_revision=lens.revision)
    lens.close()
    restarted = FakeNotebook(
        monkeypatch, tmp_path / "sales.py", {**SALES, "cell-chart": "chart(net"}
    )
    lens = BrowserLens(record=True)
    with restarted.code_mode():
        lens.context()

    # Outside code mode, the cell that does not parse is out of reach.
    assert _codes(lens.check()) == []


def test_lr003_keeps_a_deletion_when_another_cell_is_out_of_reach(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Explain the net cell", cells=["cell-net"])
    with notebook.code_mode():
        lens.resolve(request_id, expected_revision=lens.revision)
    notebook.delete("cell-net")
    with notebook.code_mode():
        lens.context()
    # An unrelated cell stops parsing outside code mode.
    notebook.set("cell-data", "sales = load(")

    assert _codes(lens.check()) == ["LR003"]


def test_brief_lists_checks_on_the_current_selection(notebook: FakeNotebook) -> None:
    lens = BrowserLens()
    lens.put(selection(output_cell_id="cell-chart"))
    notebook.set("cell-chart", "chart(net, title='Net revenue')")

    brief = lens.context().brief

    assert (
        "Checks:\n- LV003 changed-since-selected: S1 was selected before cell "
        "`cell-chart` changed, so its note and image describe the earlier output."
    ) in brief


NOTEBOOK = textwrap.dedent(
    """
    import marimo

    app = marimo.App()


    @app.cell
    def _():
        sales = load()
        return (sales,)


    @app.cell
    def _(sales):
        net = sales[sales.amount > 0]
        return (net,)


    @app.cell
    def _(net):
        chart(net)
        return
    """
)


def test_cli_checks_a_notebook_file_against_its_record(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / "sales.py"
    FakeNotebook(monkeypatch, path, dict(SALES))
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Keep refunds", cells=["cell-net"])
    lens.resolve(request_id, expected_revision=lens.revision)
    path.write_text(NOTEBOOK)

    clean = main(["check", str(path)])
    [record] = tmp_path.rglob("*.jsonl")
    with record.open("a") as handle:
        handle.write("not json\n")
    flagged = main(["check", "--json", str(path)])

    assert clean == 0
    assert flagged == 1
    [line] = capsys.readouterr().out.splitlines()
    assert json.loads(line)["code"] == "LR001"


def test_cli_finds_the_record_of_a_relative_path_under_a_cache_prefix(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: pathlib.Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "pycache_prefix", str(tmp_path / "cache"))
    path = tmp_path / "work" / "sales.py"
    path.parent.mkdir()
    FakeNotebook(monkeypatch, path, dict(SALES))
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Keep refunds", cells=["cell-net"])
    lens.resolve(request_id, expected_revision=lens.revision)
    path.write_text(NOTEBOOK)
    [record] = (tmp_path / "cache").rglob("*.jsonl")
    with record.open("a") as handle:
        handle.write("not json\n")
    monkeypatch.chdir(path.parent)

    status = main(["check", "--json", "sales.py"])

    assert status == 1
    [line] = capsys.readouterr().out.splitlines()
    assert json.loads(line)["code"] == "LR001"


def test_cli_fails_a_record_it_cannot_read(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "sales.py"
    path.write_text(NOTEBOOK)
    # A directory where the record file belongs fails every read.
    (tmp_path / "__marimo__" / "lens" / "sales.py.jsonl").mkdir(parents=True)

    status = main(["check", "--json", str(path)])

    assert status == 1
    [line] = capsys.readouterr().out.splitlines()
    assert json.loads(line)["code"] == "LR005"


def test_lr006_reports_that_the_oldest_requests_went_unchecked(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._record import files

    monkeypatch.setattr(files, "MAX_READ_BYTES", 600)
    lens = BrowserLens(record=True)
    for index in range(3):
        request_id = lens.open_request(f"Request {index}")
        lens.resolve(request_id, expected_revision=lens.revision)

    assert _codes(lens.check()) == ["LR006"]


def test_cli_reports_a_file_marimo_cannot_load(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "broken.py"
    path.write_text("import marimo\napp = marimo.App(\n")

    assert main(["check", str(path)]) == 2
    assert "marimo cannot load" in capsys.readouterr().err
