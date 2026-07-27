from __future__ import annotations

import hashlib
import struct
import zlib
from array import array
from collections.abc import Callable

import pytest
from marimo_lens._images import (
    ImageError,
    prepare_output_image,
    prepare_selection_image,
)

from tests.support.factories import png, snapshot_metadata


def _png_with_image_data(
    image_data: bytes,
    *,
    width: int = 2,
    height: int = 2,
    interlace: int = 0,
) -> bytes:
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(
                b"IHDR",
                struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, interlace),
            ),
            _chunk(b"IDAT", image_data),
            _chunk(b"IEND", b""),
        ]
    )


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def test_selection_image_validation_returns_raw_bytes() -> None:
    data = png(3, 2)
    metadata = snapshot_metadata(data, width=3, height=2)
    image = prepare_selection_image(
        "selection-1",
        metadata,
        memoryview(data),
        other_bytes=0,
    )

    assert image.data == data
    assert image.width == 3
    assert image.height == 2
    assert image.sha256 == hashlib.sha256(data).hexdigest()
    assert image.captured_at == "2026-07-14T11:58:00Z"
    assert image.outdated is False


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda metadata: metadata.update(width=9), "image_metadata_mismatch"),
        (lambda metadata: metadata.update(sha256="0" * 64), "image_metadata_mismatch"),
    ],
)
def test_selection_image_rejects_metadata_that_does_not_match_png(
    mutate: Callable[[dict[str, object]], None],
    code: str,
) -> None:
    data = png()
    metadata = snapshot_metadata(data)
    mutate(metadata)

    with pytest.raises(ImageError) as raised:
        prepare_selection_image("selection-1", metadata, data, other_bytes=0)

    assert raised.value.code == code


def test_selection_image_rejects_corrupt_png_checksum() -> None:
    data = bytearray(png())
    data[-1] ^= 1
    metadata = snapshot_metadata(bytes(data))

    with pytest.raises(ImageError) as raised:
        prepare_selection_image("selection-1", metadata, data, other_bytes=0)

    assert raised.value.code == "invalid_png"


@pytest.mark.parametrize(
    "image_data",
    [
        _png_with_image_data(b"not a zlib stream"),
        _png_with_image_data(zlib.compress((b"\x05" + b"\x00" * 16) + (b"\x00" * 17))),
        _png_with_image_data(
            zlib.compress(b"\x00" + b"\x00" * 16),
            interlace=1,
        ),
    ],
)
def test_selection_image_rejects_png_data_that_cannot_be_decoded(
    image_data: bytes,
) -> None:
    with pytest.raises(ImageError) as raised:
        prepare_selection_image(
            "selection-1",
            snapshot_metadata(image_data),
            image_data,
            other_bytes=0,
        )

    assert raised.value.code == "invalid_png"


def test_selection_image_rejects_declared_dimensions_before_decompression() -> None:
    image_data = _png_with_image_data(
        b"not a zlib stream",
        width=2049,
        height=1,
    )

    with pytest.raises(ImageError) as raised:
        prepare_selection_image(
            "selection-1",
            snapshot_metadata(image_data, width=2049, height=1),
            image_data,
            other_bytes=0,
        )

    assert raised.value.code == "image_dimensions_exceeded"


def test_selection_image_measures_typed_memoryviews_in_bytes() -> None:
    data = png()
    assert len(data) % 2 == 0
    typed_buffer = memoryview(array("B", data)).cast("H")
    assert len(typed_buffer) < typed_buffer.nbytes

    with pytest.raises(ImageError) as raised:
        prepare_selection_image(
            "selection-1",
            snapshot_metadata(data),
            typed_buffer,
            other_bytes=0,
            max_image_bytes=len(data) - 1,
        )

    assert raised.value.code == "image_too_large"


def test_selection_image_enforces_total_budget() -> None:
    first_data = png(2, 2)
    second_data = png(3, 3)
    limit = len(first_data) + len(second_data) - 1
    first = prepare_selection_image(
        "selection-1",
        snapshot_metadata(first_data),
        first_data,
        other_bytes=0,
        max_total_bytes=limit,
    )

    with pytest.raises(ImageError) as raised:
        prepare_selection_image(
            "selection-2",
            snapshot_metadata(
                second_data,
                selection_id="selection-2",
                width=3,
                height=3,
            ),
            second_data,
            other_bytes=len(first.data),
            max_total_bytes=limit,
        )

    assert raised.value.code == "image_store_full"
    assert first.data == first_data


def test_output_image_is_a_detached_validated_transfer() -> None:
    data = png(3, 3)
    image = prepare_output_image(
        "request-1",
        "cell-view",
        _output_metadata(data, request_id="request-1", width=3, height=3),
        data,
    )

    assert image.request_id == "request-1"
    assert image.cell_id == "cell-view"
    assert image.data == data
    assert image.width == 3
    assert image.height == 3
    assert image.sha256 == hashlib.sha256(data).hexdigest()


def test_output_image_rejects_another_request_identity() -> None:
    data = png()

    with pytest.raises(ImageError) as raised:
        prepare_output_image(
            "request-1",
            "cell-view",
            _output_metadata(data, request_id="request-2", width=2, height=2),
            data,
        )

    assert raised.value.code == "invalid_image"


def _output_metadata(
    data: bytes,
    *,
    request_id: str,
    width: int,
    height: int,
) -> dict[str, object]:
    return {
        "status": "available",
        "id": f"image:{request_id}",
        "mediaType": "image/png",
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(data).hexdigest(),
        "capturedAt": "2026-07-18T12:00:00Z",
    }
