from __future__ import annotations

import pathlib

import pytest
from marimo._core.document import code_hash

from tests.support.browser import BrowserLens
from tests.support.factories import selection
from tests.support.kernel import FakeNotebook


@pytest.fixture
def notebook(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path) -> FakeNotebook:
    return FakeNotebook(monkeypatch, tmp_path / "sales.py", {"chart": "chart = 1"})


# marimo's host protocol names the chart cell's code by this `code_hash`.
CHART_HASH = code_hash("chart = 1")


def test_context_request_cells_carry_the_code_the_request_opened_against(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    lens.put(selection(note="Check the total", output_cell_id="chart"))
    lens.open_request("Explain the chart", cells=["chart"])
    notebook.set("chart", "chart = 2")
    context = lens.context()

    [selection_cell] = context.references["selections"][0]["cells"]
    [chat_cell] = context.references["chatRequests"][0]["cells"]
    assert (
        selection_cell
        == chat_cell
        == {
            "id": "chart",
            "status": "available",
            "codeHash": CHART_HASH,
        }
    )
    assert CHART_HASH != code_hash("chart = 2")


def test_context_request_follows_the_newest_open_request(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    cells = [{"id": "chart", "status": "available", "codeHash": CHART_HASH}]
    assert lens.context().request is None

    lens.put(selection(note="Check the total", output_cell_id="chart"))
    assert lens.context().request == {
        "id": "selection-1",
        "channel": "selection",
        "label": "S1",
        "note": "Check the total",
        "cells": cells,
    }

    request_id = lens.open_request("Explain the chart", cells=["chart"])
    context = lens.context()
    assert context.request == {
        "id": request_id,
        "channel": "chat",
        "label": None,
        "note": "Explain the chart",
        "cells": cells,
    }

    lens.resolve(request_id, expected_revision=context.revision)
    fresh = lens.context().request
    assert fresh is not None and fresh["id"] == "selection-1"
    assert context.request is not None and context.request["id"] == request_id

    lens.resolve("selection-1", expected_revision=lens.revision)
    assert lens.context().request is None


def test_context_request_copy_keeps_its_captured_cells_and_note(
    notebook: FakeNotebook,
) -> None:
    lens = BrowserLens()
    request_id = lens.open_request("Explain the chart", cells=["chart"])
    context = lens.context()
    request = context.request
    assert request is not None
    request["cells"].clear()
    request["note"] = "Changed locally"

    captured = context.request
    assert captured is not None
    assert captured["note"] == "Explain the chart"
    assert [cell["id"] for cell in captured["cells"]] == ["chart"]
    lens.resolve(request_id, expected_revision=context.revision)
    assert context.request == captured
    assert lens.context().request is None
