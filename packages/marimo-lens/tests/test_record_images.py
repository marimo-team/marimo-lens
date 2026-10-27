from __future__ import annotations

import copy
import hashlib
import json
import pathlib
from typing import Any

import pytest
from marimo_lens._record import files

from tests.support.browser import RecordBrowserLens
from tests.support.factories import png, selection
from tests.support.kernel import SALES, FakeNotebook


def _put_with_image(
    lens: RecordBrowserLens, data: bytes, **values: Any
) -> dict[str, Any]:
    response = lens.put(selection(output_cell_id="cell-chart", **values), image=data)
    return response["payload"]["selection"]


def _lens_folder(tmp_path: pathlib.Path) -> pathlib.Path:
    return tmp_path / "__marimo__" / "lens"


def test_resolve_stores_the_image_beside_the_record_and_links_it(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    data = png()
    _put_with_image(lens, data)

    lens.resolve("selection-1", expected_revision=lens.revision)

    sha256 = hashlib.sha256(data).hexdigest()
    stored = _lens_folder(tmp_path) / "images" / f"{sha256}.png"
    assert stored.read_bytes() == data
    [line] = (
        (_lens_folder(tmp_path) / "sales.py.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    )
    assert json.loads(line)["trace"]["image"] == {
        "sha256": sha256,
        "width": 2,
        "height": 2,
        "capturedAt": "2026-07-14T11:58:00Z",
        "outdated": False,
    }
    [row] = lens.context().history()
    assert row["image"] is not None
    assert row["image"]["path"] == str(stored)
    [entry] = lens.history_entries()
    response = lens.command("history.image", {"sha256": entry["image"]["sha256"]})
    assert response["payload"] == {"sha256": sha256}
    assert lens.sent[-1][1] == [data]


def test_a_moved_selection_records_its_image_as_outdated(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    data = png()
    moved = copy.deepcopy(_put_with_image(lens, data))
    moved["anchor"]["x"] = 0.5
    moved["snapshot"]["status"] = "outdated"
    lens.command(
        "selection.put",
        {
            "selection": moved,
            "expectedRevision": lens.revision,
            "imageAction": "preserve",
        },
    )

    lens.resolve("selection-1", expected_revision=lens.revision)

    [row] = lens.context().history()
    assert row["image"] is not None
    assert row["image"]["outdated"] is True


def test_an_image_is_written_before_the_line_that_names_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    data = png()
    _put_with_image(lens, data)
    append = files.append
    locked = True

    # While the record file is locked, the image lands and the line does not.
    def fail_on_lines(path: pathlib.Path, entries: Any) -> None:
        if not locked:
            append(path, entries)
            return
        for entry in entries:
            image = entry.line.trace.image
            if image is not None and entry.image is not None:
                files.store_image(path.parent / "images", image.sha256, entry.image)
        raise OSError("record file locked by the backup tool")

    monkeypatch.setattr(files, "append", fail_on_lines)
    lens.resolve("selection-1", expected_revision=lens.revision)
    folder = _lens_folder(tmp_path)
    assert [path.name for path in (folder / "images").iterdir()] == [
        f"{hashlib.sha256(data).hexdigest()}.png"
    ]
    assert not (folder / "sales.py.jsonl").exists()
    locked = False

    [row] = lens.context().history()

    assert lens.context().references["notebook"]["record"] == {"status": "saved"}
    assert row["image"] is not None
    assert row["image"]["path"] is not None


def test_a_record_line_outlives_its_missing_or_damaged_image(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    first, second = png(), png(width=3)
    _put_with_image(lens, first)
    _put_with_image(lens, second, selection_id="s2", label="S2")
    lens.resolve(["selection-1", "s2"], expected_revision=lens.revision)
    images = _lens_folder(tmp_path) / "images"
    (images / f"{hashlib.sha256(first).hexdigest()}.png").unlink()
    (images / f"{hashlib.sha256(second).hexdigest()}.png").write_bytes(b"not a png")

    rows = lens.context().history()
    diagnostics = lens.check()

    assert [row["id"] for row in rows] == ["selection-1", "s2"]
    assert [row["image"]["path"] if row["image"] else "" for row in rows] == [
        None,
        None,
    ]
    assert [item["code"] for item in diagnostics] == ["LR004", "LR004"]


def test_browser_learns_when_a_recorded_image_is_gone(
    notebook: FakeNotebook,
) -> None:
    lens = RecordBrowserLens()

    missing = lens.refused("history.image", {"sha256": "0" * 64})
    malformed = lens.refused("history.image", {"sha256": "../../secrets"})

    assert missing == "history_image_not_found"
    assert malformed == "invalid_request"


def test_an_unsaved_notebook_keeps_images_with_its_waiting_lines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeNotebook(monkeypatch, None, dict(SALES))
    lens = RecordBrowserLens()
    data = png()
    _put_with_image(lens, data)
    lens.resolve("selection-1", expected_revision=lens.revision)
    [entry] = lens.history_entries()

    lens.command("history.image", {"sha256": entry["image"]["sha256"]})

    assert lens.sent[-1][1] == [data]
    [row] = lens.context().history()
    assert row["image"] is not None
    assert row["image"]["path"] is None


def test_identical_images_share_one_file(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    data = png()
    _put_with_image(lens, data)
    _put_with_image(lens, data, selection_id="s2", label="S2")

    lens.resolve(["selection-1", "s2"], expected_revision=lens.revision)

    assert [path.name for path in (_lens_folder(tmp_path) / "images").iterdir()] == [
        f"{hashlib.sha256(data).hexdigest()}.png"
    ]
