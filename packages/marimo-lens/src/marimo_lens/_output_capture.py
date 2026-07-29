"""Single-use browser output capture for agent consumers."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from time import monotonic
from typing import Any, Literal
from uuid import uuid4

from ._images import ImageError, OutputImage, prepare_output_image
from ._protocol import (
    CaptureResponse,
    ProtocolError,
    capture_command,
    parse_capture_response,
    request_id_from,
)
from ._runtime import RuntimeCellStatus
from .errors import LensError

CAPTURE_TIMEOUT_SECONDS = 20.0

CaptureStatus = Literal["pending", "available", "failed"]


class _CaptureSendError(RuntimeError):
    """The browser transport callback rejected a capture command."""


class _CaptureResponseError(RuntimeError):
    """A capture response failed outside the validated protocol contract."""


@dataclass(frozen=True, slots=True)
class OutputCaptureResult:
    """One detached read from the transient output-capture mailbox."""

    request_id: str
    cell_id: str
    selection_ids: tuple[str, ...]
    status: CaptureStatus
    image: OutputImage | None = None
    error_code: str | None = None
    error: str | None = None


@dataclass(slots=True)
class _CaptureRecord:
    request_id: str
    cell_id: str
    selection_ids: tuple[str, ...]
    started_at: float
    timeout: threading.Timer
    status: CaptureStatus = "pending"
    image: OutputImage | None = None
    error_code: str | None = None
    error: str | None = None


class OutputCaptureMailbox:
    """Transfer one browser-rendered PNG to one consuming agent request."""

    __slots__ = (
        "_browser_ready",
        "_cell_status",
        "_closed",
        "_lock",
        "_record",
        "_revision",
        "_send",
        "_timeout_seconds",
    )

    def __init__(
        self,
        *,
        lock: threading.RLock,
        send: Callable[[dict[str, Any]], None],
        revision: Callable[[], int],
        cell_status: Callable[[str], RuntimeCellStatus],
        timeout_seconds: float = CAPTURE_TIMEOUT_SECONDS,
    ) -> None:
        self._lock = lock
        self._send = send
        self._revision = revision
        self._cell_status = cell_status
        self._timeout_seconds = timeout_seconds
        self._record: _CaptureRecord | None = None
        self._browser_ready = False
        self._closed = False

    def start(
        self,
        cell_id: str,
        *,
        expected_revision: int,
        selections: Sequence[Mapping[str, Any]] = (),
    ) -> str:
        """Start one fresh capture and return its opaque request ID."""

        with self._lock:
            self._require_open()
            self._expire_pending()
            if self._record is not None and self._record.status == "pending":
                self._raise_busy()

        cell_status = self._cell_status(cell_id)

        with self._lock:
            self._require_open()
            self._expire_pending()
            if self._record is not None and self._record.status == "pending":
                self._raise_busy()
            revision = self._revision()
            if revision != expected_revision:
                raise LensError(
                    "revision_conflict",
                    (
                        f"Expected Lens revision {expected_revision}, "
                        f"but the current revision is {revision}."
                    ),
                    revision=revision,
                )
            if cell_status == "unavailable":
                raise LensError(
                    "runtime_unavailable",
                    "Lens cannot inspect the active marimo runtime.",
                    revision=self._revision(),
                )
            if cell_status == "missing":
                raise LensError(
                    "cell_not_found",
                    "The active marimo dataflow graph has no cell with this ID.",
                    revision=self._revision(),
                )
            if not self._browser_ready:
                raise LensError(
                    "browser_unavailable",
                    "The displayed Lens cannot capture notebook output.",
                    revision=self._revision(),
                )

            self._release_record()
            request_id = str(uuid4())
            command = capture_command(
                request_id=request_id,
                cell_id=cell_id,
                selections=selections,
            )
            timeout = threading.Timer(
                self._timeout_seconds,
                self._timed_out,
                args=(request_id,),
            )
            timeout.daemon = True
            record = _CaptureRecord(
                request_id=request_id,
                cell_id=cell_id,
                selection_ids=tuple(
                    str(selection["selectionId"]) for selection in selections
                ),
                started_at=monotonic(),
                timeout=timeout,
            )
            self._record = record
            timeout.start()
            try:
                _send_capture_command(self._send, command)
            except _CaptureSendError:
                self._fail(
                    request_id,
                    code="capture_failed",
                    message="Lens could not send the capture request to the browser.",
                )
            return request_id

    def read(self, request_id: str) -> OutputCaptureResult:
        """Read pending state or consume one terminal capture result."""

        with self._lock:
            self._require_open()
            self._expire_pending()
            record = self._record
            if record is None or record.request_id != request_id:
                raise LensError(
                    "capture_expired",
                    "The output capture is unavailable or was already consumed.",
                    revision=self._revision(),
                )
            result = _result(record)
            if record.status != "pending":
                self._release_record()
            return result

    def set_browser_ready(self, ready: bool) -> None:
        with self._lock:
            if self._closed:
                return
            self._browser_ready = ready
            record = self._record
            if not ready and record is not None and record.status == "pending":
                self._fail(
                    record.request_id,
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
                or record.status != "pending"
            ):
                return
            self._expire_pending()
            if self._record is not record or record.status != "pending":
                return
            try:
                response = _read_capture_response(content, buffers)
                if response.cell_id != record.cell_id:
                    raise ProtocolError(
                        "invalid_response",
                        "Cell capture response does not identify its request cell.",
                    )
                if response.image is None:
                    code = (
                        response.error_code
                        if response.error_code
                        in {
                            "browser_unavailable",
                            "capture_timeout",
                            "output_unavailable",
                        }
                        else "capture_failed"
                    )
                    self._fail(
                        request_id,
                        code=code,
                        message=response.error or "Cell output capture failed.",
                    )
                    return
                record.image = _prepare_captured_output(
                    request_id,
                    record.cell_id,
                    response.image,
                    buffers[0],
                )
                record.status = "available"
                record.error_code = None
                record.error = None
                record.timeout.cancel()
            except (ProtocolError, ImageError) as error:
                self._fail(
                    request_id,
                    code="capture_failed",
                    message=str(error),
                )
            except _CaptureResponseError:
                self._fail(
                    request_id,
                    code="capture_failed",
                    message="Lens could not store the captured cell output.",
                )

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._release_record()
            self._browser_ready = False

    def _fail(self, request_id: str, *, code: str, message: str) -> None:
        record = self._record
        if (
            record is None
            or record.request_id != request_id
            or record.status != "pending"
        ):
            return
        record.timeout.cancel()
        record.status = "failed"
        record.image = None
        record.error_code = code
        record.error = message

    def _timed_out(self, request_id: str) -> None:
        with self._lock:
            self._fail(
                request_id,
                code="capture_timeout",
                message="The browser did not finish the cell capture in time.",
            )

    def _expire_pending(self) -> None:
        record = self._record
        if (
            record is not None
            and record.status == "pending"
            and monotonic() - record.started_at >= self._timeout_seconds
        ):
            self._fail(
                record.request_id,
                code="capture_timeout",
                message="The browser did not finish the cell capture in time.",
            )

    def _release_record(self) -> None:
        record = self._record
        if record is not None:
            record.timeout.cancel()
        self._record = None

    def _require_open(self) -> None:
        if self._closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._revision(),
            )

    def _raise_busy(self) -> None:
        raise LensError(
            "capture_busy",
            "Lens is already capturing a cell output.",
            revision=self._revision(),
        )


def _result(record: _CaptureRecord) -> OutputCaptureResult:
    return OutputCaptureResult(
        request_id=record.request_id,
        cell_id=record.cell_id,
        selection_ids=record.selection_ids,
        status=record.status,
        image=record.image,
        error_code=record.error_code,
        error=record.error,
    )


def _send_capture_command(
    send: Callable[[dict[str, Any]], None],
    command: dict[str, Any],
) -> None:
    try:
        send(command)
    except Exception as error:
        raise _CaptureSendError from error


def _read_capture_response(
    content: Mapping[str, Any],
    buffers: Sequence[bytes | bytearray | memoryview],
) -> CaptureResponse:
    try:
        return parse_capture_response(content, buffers)
    except ProtocolError:
        raise
    except Exception as error:
        raise _CaptureResponseError from error


def _prepare_captured_output(
    request_id: str,
    cell_id: str,
    metadata: Mapping[str, Any],
    buffer: bytes | bytearray | memoryview,
) -> OutputImage:
    try:
        return prepare_output_image(request_id, cell_id, metadata, buffer)
    except ImageError:
        raise
    except Exception as error:
        raise _CaptureResponseError from error


__all__ = [
    "CAPTURE_TIMEOUT_SECONDS",
    "OutputCaptureMailbox",
    "OutputCaptureResult",
]
