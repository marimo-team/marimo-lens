from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from marimo_lens import Lens, LensContext, LensError, SelectionImage, agent
from marimo_lens._images import OutputImage
from marimo_lens._output_capture import OutputCaptureResult

from tests.support.factories import png


class _MarimoWrapper:
    __module__ = "marimo.fake"

    def __init__(self, widget: Lens) -> None:
        self.widget = widget


def _context(
    lens: Lens,
    *,
    aliases: dict[str, object] | None = None,
    cell: object | None = None,
) -> SimpleNamespace:
    namespace = {"_cell_demo_lens": lens, **(aliases or {})}
    graph = SimpleNamespace(cells={"cell-view": cell} if cell is not None else {})
    return SimpleNamespace(globals=namespace, graph=graph)


def _lens_context(
    *,
    revision: int = 4,
    note: str = "Make this blue",
    images: tuple[SelectionImage, ...] = (),
) -> LensContext:
    return LensContext(
        {
            "revision": revision,
            "notebook": {"path": "/workspace/demo.py", "available": True},
            "currentSelectionId": "selection-1",
            "selections": [
                {
                    "id": "selection-1",
                    "label": "S1",
                    "note": note,
                    "outputCellId": "cell-view",
                    "cellStatus": "available",
                    "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
                    "domHint": {"tag": "svg", "text": "Quarterly revenue"},
                    "snapshot": {"status": "available"},
                }
            ],
        },
        "full Lens context",
        images,
    )


def test_discover_deduplicates_aliases_and_preserves_identity() -> None:
    lens = Lens()
    context = _context(
        lens,
        aliases={"alias": lens, "wrapped": _MarimoWrapper(lens)},
    )

    first = agent.discover(context)
    second = agent.discover(context, identity=first[0].identity)

    assert len(first) == 1
    assert first[0].names == ("alias", "wrapped", "_lens")
    assert second[0].identity == first[0].identity
    assert agent.discover(context, identity="another-lens") == ()
    lens.close()


def test_discover_skips_closed_lenses() -> None:
    lens = Lens()
    lens.close()

    assert agent.discover(_context(lens)) == ()


def test_scan_returns_bounded_current_attention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lens = Lens()
    context_value = _lens_context(note="x" * 1_100)
    monkeypatch.setattr(Lens, "context", lambda _self: context_value)
    context = _context(
        lens,
        cell=SimpleNamespace(
            code="chart = make_chart(data)",
            defs={"chart"},
            refs={"data"},
        ),
    )

    scan = agent.discover(context)[0].scan()

    assert scan["revision"] == 4
    assert scan["lens"] == {
        "variable": "_lens",
        "aliases": [],
        "omittedAliasCount": 0,
    }
    assert scan["selectionCount"] == 1
    assert scan["current"] == {
        "id": "selection-1",
        "label": "S1",
        "outputCellId": "cell-view",
        "cellStatus": "available",
        "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
        "note": {"text": "x" * 1_000, "truncated": True},
        "snapshotStatus": "available",
        "domHint": {"tag": "svg", "text": "Quarterly revenue"},
    }
    assert scan["currentCell"] == {
        "id": "cell-view",
        "status": "available",
        "defs": ["chart"],
        "refs": ["data"],
        "codeCharacters": 24,
    }
    lens.close()


def test_context_and_selection_image_guard_the_scan_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png()
    image = SelectionImage(
        id="image:selection-1",
        selection_id="selection-1",
        media_type="image/png",
        data=data,
        width=2,
        height=2,
        sha256=hashlib.sha256(data).hexdigest(),
        captured_at="2026-07-27T10:00:00Z",
        outdated=False,
    )
    lens = Lens()
    context_value = _lens_context(images=(image,))
    monkeypatch.setattr(Lens, "context", lambda _self: context_value)
    mounted = agent.discover(_context(lens))[0]

    with pytest.raises(LensError) as raised:
        mounted.context(expected_revision=3)

    assert raised.value.code == "revision_conflict"
    transferred = mounted.selection_image(
        "selection-1",
        expected_revision=4,
    )
    assert transferred is not None
    assert transferred.source == "selection"
    assert transferred.cell_id == "cell-view"
    assert transferred.data == data
    lens.close()


def test_cell_image_adapts_private_capture_mailbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png(3, 2)
    output = OutputImage(
        request_id="request-1",
        cell_id="cell-view",
        media_type="image/png",
        data=data,
        width=3,
        height=2,
        sha256=hashlib.sha256(data).hexdigest(),
        captured_at="2026-07-27T10:00:00Z",
    )
    lens = Lens()
    monkeypatch.setattr(Lens, "context", lambda _self: _lens_context())
    monkeypatch.setattr(
        Lens,
        "_start_output_capture",
        lambda _self, _cell_id: "request-1",
    )
    monkeypatch.setattr(
        Lens,
        "_read_output_capture",
        lambda _self, _request_id: OutputCaptureResult(
            request_id="request-1",
            cell_id="cell-view",
            selection_ids=("selection-1",),
            status="available",
            image=output,
        ),
    )
    mounted = agent.discover(_context(lens))[0]

    request_id = mounted.start_cell_image("cell-view", expected_revision=4)
    result = mounted.read_cell_image(request_id)

    assert request_id == "request-1"
    assert result.status == "available"
    assert result.image is not None
    assert result.image.source == "cell"
    assert result.image.data == data
    lens.close()


def test_mounted_lens_forwards_reveal_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str | None, int | None]] = []
    lens = Lens()
    monkeypatch.setattr(
        Lens,
        "reveal",
        lambda _self, cell_id, *, message=None, duration_ms=None: calls.append(
            (cell_id, message, duration_ms)
        ),
    )
    mounted = agent.discover(_context(lens))[0]

    mounted.reveal(
        "cell-view",
        message="Updated the chart and verified its labels.",
        duration_ms=8_000,
    )

    assert calls == [
        (
            "cell-view",
            "Updated the chart and verified its labels.",
            8_000,
        )
    ]
    lens.close()


def test_materialize_script_validates_writes_and_cleans_image(
    tmp_path: Path,
) -> None:
    data = png()
    image = agent.AgentImage(
        source="cell",
        media_type="image/png",
        data=data,
        width=2,
        height=2,
        sha256=hashlib.sha256(data).hexdigest(),
        captured_at="2026-07-27T10:00:00Z",
        cell_id="cell-view",
    )
    script = (
        Path(__file__).parents[3]
        / "skills"
        / "marimo-lens"
        / "scripts"
        / "materialize-image.sh"
    )
    env = {**os.environ, "TMPDIR": str(tmp_path)}

    created = subprocess.run(
        ["bash", str(script)],
        input=image.transfer() + "\n",
        check=True,
        capture_output=True,
        env=env,
        text=True,
    )
    payload: dict[str, Any] = json.loads(created.stdout)
    image_path = Path(payload["path"])
    image_dir = Path(payload["imageDir"])

    assert payload["status"] == "available"
    assert image_path.read_bytes() == data
    removed = subprocess.run(
        ["bash", str(script), "cleanup", str(image_dir)],
        check=True,
        capture_output=True,
        env=env,
        text=True,
    )
    assert json.loads(removed.stdout) == {
        "status": "removed",
        "imageDirs": [str(image_dir)],
        "count": 1,
    }
    assert not image_dir.exists()

    unowned_dir = tmp_path / "marimo-lens.unowned"
    unowned_dir.mkdir()
    refused = subprocess.run(
        ["bash", str(script), "cleanup", str(unowned_dir)],
        check=False,
        capture_output=True,
        env=env,
        text=True,
    )
    assert refused.returncode == 1
    assert unowned_dir.exists()
