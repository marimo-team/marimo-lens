from __future__ import annotations

import hashlib
import struct
import zlib
from array import array
from collections.abc import Callable

import pytest

from marimo_lens._images import ImageError, ImageStore

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


def test_image_store_validates_png_and_returns_raw_bytes() -> None:
    data = png(3, 2)
    metadata = snapshot_metadata(data, width=3, height=2)
    store = ImageStore()

    image = store.prepare("selection-1", metadata, memoryview(data))
    store.replace(image)

    assert image.data == data
    assert image.width == 3
    assert image.height == 2
    assert image.sha256 == hashlib.sha256(data).hexdigest()
    assert image.captured_at == "2026-07-14T11:58:00Z"
    assert image.outdated is False
    assert store.snapshot(["selection-1"]) == (image,)


def test_image_store_marks_retained_bytes_outdated() -> None:
    data = png()
    store = ImageStore()
    image = store.prepare("selection-1", snapshot_metadata(data), data)
    store.replace(image)

    store.mark_outdated("selection-1")

    outdated = store.snapshot(["selection-1"])[0]
    assert outdated.data == data
    assert outdated.outdated is True


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda metadata: metadata.update(width=9), "image_metadata_mismatch"),
        (lambda metadata: metadata.update(sha256="0" * 64), "image_metadata_mismatch"),
    ],
)
def test_image_store_rejects_metadata_that_does_not_match_png(
    mutate: Callable[[dict[str, object]], None],
    code: str,
) -> None:
    data = png()
    metadata = snapshot_metadata(data)
    mutate(metadata)

    with pytest.raises(ImageError) as raised:
        ImageStore().prepare("selection-1", metadata, data)

    assert raised.value.code == code


def test_image_store_rejects_corrupt_png_checksum() -> None:
    data = bytearray(png())
    data[-1] ^= 1
    metadata = snapshot_metadata(bytes(data))

    with pytest.raises(ImageError) as raised:
        ImageStore().prepare("selection-1", metadata, data)

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
def test_image_store_rejects_png_data_that_cannot_be_decoded(
    image_data: bytes,
) -> None:
    with pytest.raises(ImageError) as raised:
        ImageStore().prepare(
            "selection-1",
            snapshot_metadata(image_data),
            image_data,
        )

    assert raised.value.code == "invalid_png"


def test_image_store_rejects_declared_dimensions_before_decompression() -> None:
    image_data = _png_with_image_data(
        b"not a zlib stream",
        width=2049,
        height=1,
    )

    with pytest.raises(ImageError) as raised:
        ImageStore().prepare(
            "selection-1",
            snapshot_metadata(image_data, width=2049, height=1),
            image_data,
        )

    assert raised.value.code == "image_dimensions_exceeded"


def test_image_store_measures_typed_memoryviews_in_bytes() -> None:
    data = png()
    assert len(data) % 2 == 0
    typed_buffer = memoryview(array("B", data)).cast("H")
    assert len(typed_buffer) < typed_buffer.nbytes

    with pytest.raises(ImageError) as raised:
        ImageStore(max_image_bytes=len(data) - 1).prepare(
            "selection-1",
            snapshot_metadata(data),
            typed_buffer,
        )

    assert raised.value.code == "image_too_large"


def test_image_store_enforces_total_budget_before_replacing_state() -> None:
    first_data = png(2, 2)
    second_data = png(3, 3)
    store = ImageStore(max_total_bytes=len(first_data) + len(second_data) - 1)
    first = store.prepare("selection-1", snapshot_metadata(first_data), first_data)
    store.replace(first)

    with pytest.raises(ImageError) as raised:
        store.prepare(
            "selection-2",
            snapshot_metadata(
                second_data,
                selection_id="selection-2",
                width=3,
                height=3,
            ),
            second_data,
        )

    assert raised.value.code == "image_store_full"
    assert store.snapshot(["selection-1", "selection-2"]) == (first,)


def test_remove_and_clear_release_image_bytes() -> None:
    data = png()
    store = ImageStore()
    image = store.prepare("selection-1", snapshot_metadata(data), data)
    store.replace(image)
    store.remove("selection-1")

    assert store.total_bytes == 0

    store.replace(image)
    store.clear()
    assert store.snapshot(["selection-1"]) == ()
