from __future__ import annotations

import hashlib
import json
import pathlib
import struct
import zlib
from collections.abc import Mapping, Sequence
from typing import Any

from marimo_lens import LensContext, LensReferences, RecordedRequest
from marimo_lens._context.build import standalone_text
from marimo_lens._notebook.snapshot import RuntimeCell, RuntimeSnapshot
from marimo_lens._record.lines import (
    OpenRequest,
    RecordHealth,
    RecordLine,
    build_line,
)
from marimo_lens._selection.references import build_references


def png(width: int = 2, height: int = 2) -> bytes:
    row = b"\x00" + (b"\x22\x66\xaa\xff" * width)
    image = row * height
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(
                b"IHDR",
                struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0),
            ),
            _chunk(b"IDAT", zlib.compress(image)),
            _chunk(b"IEND", b""),
        ]
    )


def snapshot_metadata(
    data: bytes,
    *,
    selection_id: str = "selection-1",
    width: int = 2,
    height: int = 2,
) -> dict[str, Any]:
    return {
        "status": "available",
        "id": f"image:{selection_id}",
        "mediaType": "image/png",
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(data).hexdigest(),
        "capturedAt": "2026-07-14T11:58:00Z",
    }


def selection(
    *,
    selection_id: str = "selection-1",
    label: str = "S1",
    note: str = "",
    output_cell_id: str = "cell-view",
    target: dict[str, Any] | None = None,
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": selection_id,
        "label": label,
        "note": note,
        "description": {"label": f"Cell {output_cell_id}"},
        "target": target
        or {
            "kind": "notebook",
            "cellIds": [output_cell_id],
            "documentId": "document-1",
            "documentPath": "/",
        },
        "createdAt": "2026-07-14T11:58:00Z",
        "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
        "domHint": {
            "tag": "svg",
            "role": "img",
            "ariaLabel": "Sales by category",
            "text": "",
            "path": "div > svg",
            "bounds": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.6},
        },
        "snapshot": snapshot or {"status": "pending"},
    }


def cell(
    cell_id: str,
    *,
    code: str = "",
    defs: tuple[str, ...] = (),
    refs: tuple[str, ...] = (),
    upstream: tuple[str, ...] = (),
    runtime_state: str | None = "idle",
    run_result_status: str | None = "success",
    stale: bool | None = False,
) -> RuntimeCell:
    return RuntimeCell(
        id=cell_id,
        code=code,
        defs=defs,
        refs=refs,
        upstream_cell_ids=upstream,
        language="python",
        runtime_state=runtime_state,
        run_result_status=run_result_status,
        stale=stale,
    )


def snapshot(
    *cells: RuntimeCell,
) -> RuntimeSnapshot:
    return RuntimeSnapshot(
        available=True,
        filename="/workspace/demo.py",
        reason="",
        available_cell_ids=frozenset(cell.id for cell in cells),
        cells=tuple(cells),
        controls=(),
    )


def build_context(
    runtime: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> tuple[LensReferences, str]:
    """Return the references and text an unsaved notebook's Lens builds."""

    references = build_references(
        runtime,
        selections,
        revision=revision,
        current_selection_id=current_selection_id,
        record=RecordHealth(
            "unsaved", "The notebook has no file name yet."
        ).reference(),
        code_hashes={},
    )
    return references, standalone_text(runtime, selections, current_selection_id)


def lens_context(
    references: Mapping[str, object],
    *,
    text: str = "",
    brief: str = "",
    images: Mapping[str, bytes] | None = None,
    history: Sequence[RecordedRequest] = (),
) -> LensContext:
    """Return a context with fixed references, as a code-mode fake would."""

    return LensContext._create(
        references=references,
        request=None,
        text=lambda: text,
        brief=lambda: brief,
        history=lambda _cell_ids: list(history),
        images=images or {},
    )


def record_line(
    request_id: str,
    before: Mapping[str, str] | RuntimeSnapshot,
    after: Mapping[str, str] | RuntimeSnapshot,
    *,
    kernel: str = "a" * 16,
    resolved_at: str = "2026-10-21T10:01:00+00:00",
    trace: tuple[str, ...] = (),
) -> RecordLine:
    """Return the line of a chat request whose cells went from ``before`` to ``after``.

    A mapping names each cell's code. The line keeps the code of the ``trace``
    cells it pointed at.
    """

    def notebook(cells: Mapping[str, str] | RuntimeSnapshot) -> RuntimeSnapshot:
        if isinstance(cells, RuntimeSnapshot):
            return cells
        return snapshot(*(cell(cell_id, code=code) for cell_id, code in cells.items()))

    return build_line(
        OpenRequest(
            id=request_id,
            channel="chat",
            note="Change it",
            opened_at="2026-10-21T10:00:00+00:00",
            cell_ids=trace,
            baseline=notebook(before),
        ),
        notebook(after),
        kernel=kernel,
        resolved_at=resolved_at,
        revision=1,
        summary=None,
    )


def record_lines(notebook: pathlib.Path) -> list[dict[str, Any]]:
    """Return the record lines Lens wrote for the notebook file ``notebook``."""

    path = notebook.parent / "__marimo__" / "lens" / f"{notebook.name}.jsonl"
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )
