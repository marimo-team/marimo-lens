"""Validate bounded PNG values and store selection image evidence."""

from __future__ import annotations

import hashlib
import struct
import zlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from ._protocol_models import OUTPUT_CAPTURE_IMAGE_ADAPTER
from .context import SelectionImage

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024
MAX_IMAGE_EDGE = 2048
MAX_IMAGE_PIXELS = 4_000_000

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
_PNG_BIT_DEPTHS = {
    0: frozenset({1, 2, 4, 8, 16}),
    2: frozenset({8, 16}),
    3: frozenset({1, 2, 4, 8}),
    4: frozenset({8, 16}),
    6: frozenset({8, 16}),
}
_PNG_CRITICAL_CHUNKS = frozenset({b"IHDR", b"PLTE", b"IDAT", b"IEND"})


class ImageError(ValueError):
    """Raised when a PNG violates the Lens image contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class OutputImage:
    """One validated browser rendering awaiting agent consumption."""

    request_id: str
    cell_id: str
    media_type: Literal["image/png"]
    data: bytes = field(repr=False)
    width: int
    height: int
    sha256: str
    captured_at: str


def prepare_selection_image(
    selection_id: str,
    metadata: Mapping[str, Any],
    buffer: bytes | bytearray | memoryview,
    *,
    other_bytes: int,
    max_image_bytes: int = MAX_IMAGE_BYTES,
    max_total_bytes: int = MAX_TOTAL_IMAGE_BYTES,
) -> SelectionImage:
    """Validate one marked selection capture against the Lens image budget."""

    data, width, height, digest, captured_at = _prepare_png(
        metadata,
        buffer,
        expected_id=f"image:{selection_id}",
        max_image_bytes=max_image_bytes,
    )
    if other_bytes + len(data) > max_total_bytes:
        raise ImageError(
            "image_store_full",
            f"Lens images exceed {max_total_bytes} bytes.",
        )
    return SelectionImage(
        id=f"image:{selection_id}",
        selection_id=selection_id,
        media_type="image/png",
        data=data,
        width=width,
        height=height,
        sha256=digest,
        captured_at=captured_at,
        outdated=False,
    )


def prepare_output_image(
    request_id: str,
    cell_id: str,
    metadata: Mapping[str, Any],
    buffer: bytes | bytearray | memoryview,
) -> OutputImage:
    """Validate one transient output capture."""

    data, width, height, digest, captured_at = _prepare_png(
        metadata,
        buffer,
        expected_id=f"image:{request_id}",
        max_image_bytes=MAX_IMAGE_BYTES,
    )
    return OutputImage(
        request_id=request_id,
        cell_id=cell_id,
        media_type="image/png",
        data=data,
        width=width,
        height=height,
        sha256=digest,
        captured_at=captured_at,
    )


def _prepare_png(
    metadata: Mapping[str, Any],
    buffer: bytes | bytearray | memoryview,
    *,
    expected_id: str,
    max_image_bytes: int,
) -> tuple[bytes, int, int, str, str]:
    try:
        image = OUTPUT_CAPTURE_IMAGE_ADAPTER.validate_python(metadata)
    except ValidationError as error:
        detail = error.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )[0]
        raise ImageError(
            "invalid_image",
            f"Lens image metadata {detail['msg']}.",
        ) from None
    if image.id != expected_id:
        raise ImageError(
            "invalid_image",
            "Lens image id does not identify its capture.",
        )
    buffer_bytes = buffer.nbytes if isinstance(buffer, memoryview) else len(buffer)
    if buffer_bytes > max_image_bytes:
        raise ImageError(
            "image_too_large",
            f"Lens image exceeds {max_image_bytes} bytes.",
        )
    data = bytes(buffer)
    width, height = _validate_png(data)
    if image.width != width or image.height != height:
        raise ImageError(
            "image_metadata_mismatch",
            "Lens image dimensions do not match its PNG bytes.",
        )
    digest = hashlib.sha256(data).hexdigest()
    if image.sha256 != digest:
        raise ImageError(
            "image_metadata_mismatch",
            "Lens image digest does not match its PNG bytes.",
        )
    return data, width, height, digest, image.captured_at


def _validate_png(data: bytes) -> tuple[int, int]:
    if not data.startswith(_PNG_SIGNATURE):
        raise ImageError("invalid_png", "Lens image must be a PNG.")

    offset = len(_PNG_SIGNATURE)
    width = 0
    height = 0
    bit_depth = 0
    color_type = -1
    chunk_index = 0
    saw_plte = False
    saw_idat = False
    idat_ended = False
    saw_iend = False
    idat_parts: list[bytes] = []
    while offset < len(data):
        if len(data) - offset < 12:
            raise ImageError("invalid_png", "Lens PNG has a truncated chunk.")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if chunk_end > len(data):
            raise ImageError("invalid_png", "Lens PNG has a truncated chunk.")
        chunk_data = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length : chunk_end])[0]
        actual_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ImageError("invalid_png", "Lens PNG has an invalid checksum.")

        if chunk_index == 0:
            if chunk_type != b"IHDR" or length != 13:
                raise ImageError(
                    "invalid_png",
                    "Lens PNG must begin with an IHDR chunk.",
                )
            width, height = struct.unpack(">II", chunk_data[:8])
            if width <= 0 or height <= 0:
                raise ImageError(
                    "invalid_png",
                    "Lens PNG dimensions must be positive.",
                )
            if width > MAX_IMAGE_EDGE or height > MAX_IMAGE_EDGE:
                raise ImageError(
                    "image_dimensions_exceeded",
                    f"Lens image edges must not exceed {MAX_IMAGE_EDGE} pixels.",
                )
            if width * height > MAX_IMAGE_PIXELS:
                raise ImageError(
                    "image_dimensions_exceeded",
                    f"Lens image must not exceed {MAX_IMAGE_PIXELS} pixels.",
                )
            bit_depth, color_type, compression, filter_method, interlace = chunk_data[
                8:
            ]
            if (
                color_type not in _PNG_BIT_DEPTHS
                or bit_depth not in _PNG_BIT_DEPTHS[color_type]
                or compression != 0
                or filter_method != 0
                or interlace != 0
            ):
                raise ImageError(
                    "invalid_png",
                    "Lens PNG uses an unsupported image encoding.",
                )
        elif chunk_type == b"IHDR":
            raise ImageError("invalid_png", "Lens PNG has multiple IHDR chunks.")

        if chunk_type not in _PNG_CRITICAL_CHUNKS and chunk_type[0] & 0x20 == 0:
            raise ImageError(
                "invalid_png", "Lens PNG contains an unknown critical chunk."
            )
        if chunk_type == b"PLTE":
            if saw_plte or saw_idat or not 3 <= length <= 768 or length % 3 != 0:
                raise ImageError("invalid_png", "Lens PNG has an invalid palette.")
            if color_type in {0, 4}:
                raise ImageError("invalid_png", "Lens PNG has an invalid palette.")
            saw_plte = True
        if chunk_type == b"IDAT":
            if idat_ended:
                raise ImageError(
                    "invalid_png", "Lens PNG has nonconsecutive image chunks."
                )
            saw_idat = True
            idat_parts.append(chunk_data)
        elif saw_idat and chunk_type != b"IEND":
            idat_ended = True
        if chunk_type == b"IEND":
            if length != 0 or chunk_end != len(data):
                raise ImageError("invalid_png", "Lens PNG has an invalid ending.")
            saw_iend = True
            break
        offset = chunk_end
        chunk_index += 1

    if not saw_idat or not saw_iend:
        raise ImageError("invalid_png", "Lens PNG is missing required image chunks.")
    if color_type == 3 and not saw_plte:
        raise ImageError("invalid_png", "Lens indexed PNG is missing a palette.")

    channels = _PNG_CHANNELS[color_type]
    row_bytes = (width * channels * bit_depth + 7) // 8
    expected_size = height * (row_bytes + 1)
    try:
        decompressor = zlib.decompressobj()
        decoded = decompressor.decompress(b"".join(idat_parts), expected_size + 1)
        if decompressor.unconsumed_tail or len(decoded) > expected_size:
            raise ImageError(
                "invalid_png", "Lens PNG expands beyond its declared dimensions."
            )
        decoded += decompressor.flush()
    except zlib.error as error:
        raise ImageError(
            "invalid_png", "Lens PNG image data cannot be decoded."
        ) from error
    if (
        not decompressor.eof
        or decompressor.unused_data
        or len(decoded) != expected_size
        or any(decoded[offset] > 4 for offset in range(0, expected_size, row_bytes + 1))
    ):
        raise ImageError("invalid_png", "Lens PNG image data is invalid.")
    return width, height


__all__ = [
    "ImageError",
    "OutputImage",
    "prepare_output_image",
    "prepare_selection_image",
]
