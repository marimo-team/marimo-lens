from __future__ import annotations

import hashlib
import struct
import zlib
from typing import Any

from marimo_lens._runtime import RuntimeCell, RuntimeSnapshot


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
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": selection_id,
        "label": label,
        "note": note,
        "outputCellId": output_cell_id,
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
        cells=tuple(cells),
        controls=(),
    )


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )
