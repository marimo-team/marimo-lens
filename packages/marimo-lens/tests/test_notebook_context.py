from __future__ import annotations

import json
import pathlib
from typing import Any, cast

import pytest
from marimo_lens import LensError, Selection, notebook_context
from marimo_lens.__main__ import main

from tests.support.browser import BrowserLens
from tests.support.factories import png, selection, snapshot_metadata
from tests.support.files import SALES, kernel_cells, start_kernel
from tests.support.kernel import FakeNotebook


@pytest.fixture
def path(tmp_path: pathlib.Path) -> pathlib.Path:
    notebook = tmp_path / "sales.py"
    notebook.write_text(SALES)
    return notebook


@pytest.fixture
def kernel(monkeypatch: pytest.MonkeyPatch, path: pathlib.Path) -> FakeNotebook:
    return start_kernel(monkeypatch, path)


def _without_mounted_calls(brief: str) -> str:
    return "\n".join(
        line for line in brief.splitlines() if not line.startswith("- mounted.")
    )


def test_a_cell_named_in_a_selection_has_the_id_the_editor_gives_it(
    path: pathlib.Path,
) -> None:
    chart_id = kernel_cells(path)["revenue_chart"][0]

    by_name = notebook_context(path, Selection(cell="revenue_chart"))
    by_id = notebook_context(path, Selection(cell=chart_id))

    for context in (by_name, by_id):
        [reference] = context.references["selections"]
        assert reference["target"]["cellIds"] == [chart_id]
        assert context.request is not None
        assert context.request["cells"][0]["id"] == chart_id


def test_file_context_matches_the_context_of_a_lens_on_the_running_notebook(
    path: pathlib.Path, kernel: FakeNotebook
) -> None:
    cells = kernel_cells(path)
    net_id, chart_id = cells["net"][0], cells["revenue_chart"][0]
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Keep refunds", cells=[net_id])
    kernel.set(net_id, "net = sales")
    lens.resolve(request_id, expected_revision=lens.revision)
    path.write_text(SALES.replace("sales[sales.amount > 0]", "sales"))
    image = png()
    pointed = selection(
        selection_id="selection-live",
        note="Central looks off",
        output_cell_id=chart_id,
    )
    lens.put(pointed, image=image)
    with kernel.code_mode():
        live = lens.context()

    from_file = notebook_context(
        path,
        {
            **pointed,
            "snapshot": snapshot_metadata(image, selection_id="selection-live"),
        },
        images={"selection-live": image},
    )

    assert "Earlier requests on these cells and upstream" in from_file.brief
    assert "in force on" in from_file.brief
    assert "- mounted.check()" in live.brief
    assert "- mounted." not in from_file.brief
    assert from_file.brief == _without_mounted_calls(live.brief)
    assert from_file.text == live.text
    assert from_file.images == live.images
    assert from_file.history(from_file.request) == live.history(live.request)


def test_a_selection_records_the_mark_note_hint_and_image(path: pathlib.Path) -> None:
    image = png(4, 3)

    context = notebook_context(
        path,
        Selection(
            cell="revenue_chart",
            note="Central looks off",
            mark=(0.25, 0.5, 0.5, 0.25),
            dom_hint={"tag": "path", "ariaLabel": "region: Central"},
            image=image,
        ),
    )

    [reference] = context.references["selections"]
    assert reference["label"] == "S1"
    assert reference["note"] == "Central looks off"
    assert reference["anchor"] == {
        "kind": "rect",
        "x": 0.25,
        "y": 0.5,
        "width": 0.5,
        "height": 0.25,
    }
    assert reference.get("domHint") == {"tag": "path", "ariaLabel": "region: Central"}
    assert reference.get("description") == {"label": "revenue_chart"}
    assert reference["snapshot"]["status"] == "available"
    assert context.images == {reference["id"]: image}
    assert 'Part: a region on the output of its producing cell, "revenue_chart".' in (
        context.brief
    )
    assert "Image: the analyst's view is in context.images." in context.brief
    assert 'accessible label="region: Central"' in context.text


def test_a_selection_without_a_mark_or_image_covers_the_output(
    path: pathlib.Path, tmp_path: pathlib.Path
) -> None:
    image_file = tmp_path / "pointed.png"
    image_file.write_bytes(png())

    plain = notebook_context(path, Selection(cell="net"))
    point = notebook_context(
        path, Selection(cell="net", mark=(0.4, 0.3), image=image_file)
    )

    [plain_reference] = plain.references["selections"]
    [point_reference] = point.references["selections"]
    assert plain_reference["anchor"] == {
        "kind": "rect",
        "x": 0.0,
        "y": 0.0,
        "width": 1.0,
        "height": 1.0,
    }
    assert plain_reference["snapshot"] == {"status": "pending"}
    assert point_reference["anchor"] == {"kind": "point", "x": 0.4, "y": 0.3}
    assert point.images == {point_reference["id"]: png()}


def test_the_last_selection_is_the_current_request(path: pathlib.Path) -> None:
    context = notebook_context(
        path,
        Selection(cell="net", note="Drop refunds"),
        Selection(cell="revenue_chart", note="Sort the bars"),
    )

    assert [item["label"] for item in context.references["selections"]] == [
        "S1",
        "S2",
    ]
    assert context.request is not None
    assert context.request["note"] == "Sort the bars"
    assert 'Other open requests:\n- S1 (selection) "Drop refunds"' in context.brief


def test_labels_continue_after_the_record(
    path: pathlib.Path, kernel: FakeNotebook
) -> None:
    lens = BrowserLens(record=True)
    lens.put(selection(output_cell_id=kernel_cells(path)["net"][0]))
    lens.resolve("selection-1", expected_revision=lens.revision)

    kept = notebook_context(path, Selection(cell="net"))
    unkept = notebook_context(path, Selection(cell="net"), record=False)

    assert kept.references["selections"][0]["label"] == "S2"
    assert unkept.references["selections"][0]["label"] == "S1"
    assert "Earlier requests: none kept. This Lens keeps no record." in unkept.brief
    with pytest.raises(LensError, match="record_off"):
        unkept.history()


def test_a_record_path_reads_that_record(
    path: pathlib.Path, kernel: FakeNotebook, tmp_path: pathlib.Path
) -> None:
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Keep refunds")
    lens.resolve(request_id, expected_revision=lens.revision)
    [record] = tmp_path.rglob("*.jsonl")
    moved = tmp_path / "elsewhere.jsonl"
    record.rename(moved)

    beside = notebook_context(path)
    elsewhere = notebook_context(path, record=moved)

    assert beside.history() == []
    assert [row["note"] for row in elsewhere.history()] == ["Keep refunds"]


@pytest.mark.parametrize(
    ("selections", "images", "message"),
    [
        ((Selection(cell="chart"),), None, "has no cell named 'chart'"),
        (
            (Selection(cell="net", mark=(0.5, 0.5, 0.75, 0.1)),),
            None,
            "inside the output",
        ),
        ((Selection(cell="net", mark=cast(Any, (0.5,))),), None, "mark must be"),
        ((Selection(cell="net", dom_hint={"role": "img"}),), None, "domHint.tag"),
        ((selection(snapshot=snapshot_metadata(png())),), None, "Pass its PNG"),
        ((selection(),), {"selection-1": png()}, "needs status 'available'"),
        ((selection(),), {"selection-2": png()}, "images names 'selection-2'"),
        ((selection(), selection()), None, "share the id 'selection-1'"),
        (
            (selection(snapshot={**snapshot_metadata(png()), "status": "outdated"}),),
            {"selection-1": png()},
            "has an outdated image",
        ),
        (({"id": "selection-1"},), None, "is no valid Lens selection"),
    ],
)
def test_invalid_selections_say_what_to_change(
    path: pathlib.Path,
    selections: tuple[Any, ...],
    images: dict[str, bytes] | None,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        notebook_context(path, *selections, images=images)


def test_a_file_marimo_cannot_load_is_refused(tmp_path: pathlib.Path) -> None:
    broken = tmp_path / "broken.py"
    broken.write_text("import marimo\napp = marimo.App(\n")

    with pytest.raises(ValueError, match="marimo cannot load"):
        notebook_context(broken)
    with pytest.raises(ValueError, match="marimo cannot load"):
        notebook_context(tmp_path / "missing.py")


def test_cli_prints_the_brief_for_a_cell(
    path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    status = main(
        [
            "context",
            str(path),
            "--cell",
            "revenue_chart",
            "--note",
            "Central looks off",
            "--mark",
            "0.4,0.3",
        ]
    )

    assert status == 0
    brief = capsys.readouterr().out
    assert brief.startswith('# Request S1 (selection)\n\nNote: "Central looks off"')
    assert "Part: a point on the output of its producing cell" in brief


def test_cli_prints_text_history_and_json(
    path: pathlib.Path, kernel: FakeNotebook, capsys: pytest.CaptureFixture[str]
) -> None:
    net_id = kernel_cells(path)["net"][0]
    lens = BrowserLens(record=True)
    request_id = lens.open_request("Keep refunds", cells=[net_id])
    lens.resolve(request_id, expected_revision=lens.revision)
    arguments = ["context", str(path), "--cell", "revenue_chart"]

    assert main([*arguments, "--format", "text"]) == 0
    text = capsys.readouterr().out
    assert main([*arguments, "--format", "history"]) == 0
    history = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert main([*arguments, "--format", "json"]) == 0
    full = json.loads(capsys.readouterr().out)

    assert "## Relevant cells" in text
    assert [row["note"] for row in history] == ["Keep refunds"]
    assert full["history"] == history
    assert full["text"] == text.rstrip("\n")
    assert full["request"]["note"] == ""
    assert set(full) == {"request", "references", "brief", "text", "history"}


def test_cli_takes_a_selection_file_and_its_image(
    path: pathlib.Path, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    image = png()
    chart_id = kernel_cells(path)["revenue_chart"][0]
    selection_file = tmp_path / "selection.json"
    selection_file.write_text(
        json.dumps(
            selection(output_cell_id=chart_id, snapshot=snapshot_metadata(image))
        )
    )
    image_file = tmp_path / "pointed.png"
    image_file.write_bytes(image)

    status = main(
        [
            "context",
            str(path),
            "--selection",
            str(selection_file),
            "--image",
            str(image_file),
            "--no-record",
            "--format",
            "json",
        ]
    )

    assert status == 0
    full = json.loads(capsys.readouterr().out)
    assert full["references"]["selections"][0]["snapshot"]["status"] == "available"
    assert full["history"] is None


def test_cli_reports_an_unknown_cell(
    path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["context", str(path), "--cell", "chart"]) == 2
    error = capsys.readouterr().err
    assert "has no cell named 'chart'" in error
    assert "(revenue_chart)" in error


def test_a_cell_that_does_not_parse_stays_in_the_notebook(
    tmp_path: pathlib.Path,
) -> None:
    path = tmp_path / "broken_cell.py"
    path.write_text(
        SALES.replace(
            "@app.cell\ndef net(sales):",
            'app._unparsable_cell(\n    r"""\n    total = (\n    """,\n    name="_",\n)\n\n\n'
            "@app.cell\ndef net(sales):",
        )
    )

    broken_id = kernel_cells(path)["_"][0]

    chart = notebook_context(path, Selection(cell="revenue_chart"))
    broken = notebook_context(path, Selection(cell=broken_id))

    assert "### Cell" in chart.text
    assert f"- Cell `{broken_id}`: stale" in broken.brief


def test_a_record_path_must_name_a_record_file(
    path: pathlib.Path, tmp_path: pathlib.Path
) -> None:
    with pytest.raises(ValueError, match="No record file at"):
        notebook_context(path, record=tmp_path / "missing.jsonl")


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        ([], "name the selection with --cell or --selection"),
        (["--selection", "s.json", "--note", "Look"], "describe the --cell selection"),
        (["--cell", "net", "--no-record", "--format", "history"], "drop --no-record"),
        (["--selection", "-", "--selection", "-"], "one --selection"),
    ],
)
def test_cli_refuses_arguments_that_name_no_context(
    path: pathlib.Path,
    capsys: pytest.CaptureFixture[str],
    arguments: list[str],
    message: str,
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["context", str(path), *arguments])

    assert exit_info.value.code == 2
    assert message in capsys.readouterr().err


def test_cli_prints_no_lines_for_an_empty_history(
    path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["context", str(path), "--cell", "net", "--format", "history"]) == 0
    assert capsys.readouterr().out == ""
