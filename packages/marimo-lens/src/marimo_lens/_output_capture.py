"""Single-slot browser output capture for agent consumers."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from ._images import ImageError, validate_output_png
from ._protocol import (
    ProtocolError,
    capture_command,
    parse_capture_response,
    request_id_from,
)
from ._runtime import RuntimeCellStatus
from .errors import LensError


@dataclass(slots=True)
class _Capture:
    request_id: str
    cell_id: str
    revision: int
    image: bytes | None = None
    error_code: str | None = None
    error: str | None = None


class OutputCaptureSlot:
    """Return one browser-rendered PNG across consecutive kernel calls."""

    __slots__ = (
        "_browser_ready",
        "_cell_status",
        "_closed",
        "_lock",
        "_record",
        "_revision",
        "_send",
    )

    def __init__(
        self,
        *,
        lock: threading.RLock,
        send: Callable[[dict[str, Any]], None],
        revision: Callable[[], int],
        cell_status: Callable[[str], RuntimeCellStatus],
    ) -> None:
        self._lock = lock
        self._send = send
        self._revision = revision
        self._cell_status = cell_status
        self._record: _Capture | None = None
        self._browser_ready = False
        self._closed = False

    def image(
        self,
        cell_id: str,
        *,
        expected_revision: int,
    ) -> bytes | None:
        """Return captured bytes or start the capture and return ``None``."""

        with self._lock:
            self._require_open()
            revision = self._revision()
            if revision != expected_revision:
                self._record = None
                self._raise_revision_conflict(expected_revision, revision)
            record = self._record
            if (
                record is not None
                and record.cell_id == cell_id
                and record.revision == expected_revision
            ):
                return self._read(record)
            if record is not None and _capture_pending(record):
                self._raise_busy(record)

        cell_status = self._cell_status(cell_id)

        with self._lock:
            self._require_open()
            revision = self._revision()
            if revision != expected_revision:
                self._record = None
                self._raise_revision_conflict(expected_revision, revision)
            record = self._record
            if (
                record is not None
                and record.cell_id == cell_id
                and record.revision == expected_revision
            ):
                return self._read(record)
            if record is not None and _capture_pending(record):
                self._raise_busy(record)
            self._record = None
            if cell_status == "unavailable":
                raise LensError(
                    "runtime_unavailable",
                    "Lens cannot inspect the active marimo runtime.",
                    revision=revision,
                )
            if cell_status == "missing":
                raise LensError(
                    "cell_not_found",
                    "The active marimo dataflow graph has no cell with this ID.",
                    revision=revision,
                )
            if not self._browser_ready:
                raise LensError(
                    "browser_unavailable",
                    "The displayed Lens cannot capture notebook output.",
                    revision=revision,
                )

            request_id = str(uuid4())
            command = capture_command(
                request_id=request_id,
                cell_id=cell_id,
            )
            self._record = _Capture(
                request_id=request_id,
                cell_id=cell_id,
                revision=revision,
            )
            try:
                self._send(command)
            except Exception:  # noqa: BLE001 - transport callbacks are untrusted
                self._record = None
                raise LensError(
                    "capture_failed",
                    "Lens could not send the capture request to the browser.",
                    revision=revision,
                ) from None
            return None

    def set_browser_ready(self, ready: bool) -> None:
        with self._lock:
            if self._closed:
                return
            self._browser_ready = ready
            record = self._record
            if (
                not ready
                and record is not None
                and record.image is None
                and record.error_code is None
            ):
                _fail_capture(
                    record,
                    code="browser_unavailable",
                    message="The displayed Lens became unavailable during capture.",
                )

    def accept_response(
        self,
        content: Mapping[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> None:
        try:
            request_id = request_id_from(content)
        except ProtocolError:
            return
        with self._lock:
            record = self._record
            if (
                record is None
                or record.request_id != request_id
                or record.image is not None
            ):
                return
            if record.error_code is not None:
                return
            try:
                response = parse_capture_response(content, buffers)
                if response.cell_id != record.cell_id:
                    raise ProtocolError(
                        "invalid_response",
                        "Cell capture response does not identify its request cell.",
                    )
                if response.image is None:
                    _fail_capture(
                        record,
                        code=_capture_error_code(response.error_code),
                        message=response.error or "Cell output capture failed.",
                    )
                    return
                record.image = validate_output_png(
                    request_id,
                    response.image,
                    buffers[0],
                )
            except (ProtocolError, ImageError) as error:
                _fail_capture(record, code="capture_failed", message=str(error))
            except Exception:  # noqa: BLE001 - isolate malformed browser replies
                _fail_capture(
                    record,
                    code="capture_failed",
                    message="Lens could not store the captured cell output.",
                )

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._record = None
            self._browser_ready = False

    def _read(self, record: _Capture) -> bytes | None:
        if record.error_code is not None:
            self._record = None
            raise LensError(
                record.error_code,
                record.error or "Cell output capture failed.",
                revision=self._revision(),
            )
        if record.image is None:
            return None
        image = record.image
        self._record = None
        return image

    def _require_open(self) -> None:
        if self._closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._revision(),
            )

    @staticmethod
    def _raise_revision_conflict(expected: int, current: int) -> None:
        raise LensError(
            "revision_conflict",
            f"Expected Lens revision {expected}, but the current revision is {current}.",
            revision=current,
        )

    def _raise_busy(self, record: _Capture) -> None:
        raise LensError(
            "capture_busy",
            (
                f"Lens is already capturing output for cell {record.cell_id!r}. "
                "Poll that cell before requesting another one."
            ),
            revision=self._revision(),
        )


def _capture_error_code(value: str | None) -> str:
    if value in {"browser_unavailable", "capture_timeout", "output_unavailable"}:
        return value
    return "capture_failed"


def _capture_pending(record: _Capture) -> bool:
    return record.image is None and record.error_code is None


def _fail_capture(record: _Capture, *, code: str, message: str) -> None:
    record.image = None
    record.error_code = code
    record.error = message


__all__ = ["OutputCaptureSlot"]
