"""Validated browser transport for Lens selections and image capture."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypeVar

from pydantic import TypeAdapter, ValidationError

from .._core.bounds import (
    MAX_ERROR,
    REQUEST_ID_ADAPTER,
    utf16_text,
)
from .._core.errors import Rejection
from .._schema.model import dump_model
from .._schema.selection import AvailableSnapshot, OutdatedSnapshot
from .messages import (
    CAPTURE_BROWSER_EVENT_ADAPTER,
    CAPTURE_RESPONSE_ADAPTER,
    COMMAND_ADAPTER,
    COMMAND_PROTOCOL,
    EVENT_PROTOCOL,
    PROTOCOL_VERSION,
    RESPONSE_PROTOCOL,
    ClientCommand,
    ErrorDetail,
    FailureResponse,
    OutputCaptureCommand,
    OutputCaptureFailure,
    OutputCapturePayload,
    OutputCaptureReady,
    OutputCaptureSuccess,
    PutSelectionCommand,
    SuccessResponse,
)

if TYPE_CHECKING:
    from .._selection.images import SelectionImage

CaptureBrowserEvent = Literal["ready", "unready"]

_CUSTOM_ERROR_CODES = {
    "invalid_image",
    "invalid_image_action",
    "invalid_selection",
}
_ModelT = TypeVar("_ModelT")


class ProtocolError(Rejection):
    """Raised when a browser message violates the transport contract."""


@dataclass(frozen=True, slots=True)
class CaptureResponse:
    """One validated browser reply to a cell output capture request."""

    cell_id: str
    image: dict[str, Any] | None
    error_code: str | None
    error: str | None


def parse_capture_browser_event(
    content: object,
    buffers: Sequence[bytes | bytearray | memoryview],
) -> CaptureBrowserEvent | None:
    """Parse the private browser readiness signal for reverse capture."""

    if not isinstance(content, Mapping) or content.get("protocol") != EVENT_PROTOCOL:
        return None
    event_type = content.get("type")
    if not isinstance(event_type, str) or event_type not in {
        "output.capture.ready",
        "output.capture.unready",
    }:
        return None
    _require_no_buffers(buffers)
    event = _validate_model(
        CAPTURE_BROWSER_EVENT_ADAPTER,
        content,
        context="Lens readiness event",
    )
    return "ready" if isinstance(event, OutputCaptureReady) else "unready"


def parse_command(
    content: object,
    buffers: Sequence[bytes | bytearray | memoryview],
) -> ClientCommand | None:
    """Parse one Lens command or ignore an envelope owned by another feature."""

    if not isinstance(content, Mapping) or content.get("protocol") != COMMAND_PROTOCOL:
        return None
    command = _validate_model(COMMAND_ADAPTER, content, context="Lens command")
    if isinstance(command, PutSelectionCommand):
        if command.payload.image_action == "replace":
            if len(buffers) != 1:
                raise ProtocolError(
                    "invalid_buffers",
                    "Replacing a selection image requires exactly one PNG buffer.",
                )
        else:
            _require_no_buffers(buffers)
    else:
        _require_no_buffers(buffers)
    return command


def capture_command(
    *,
    request_id: str,
    cell_id: str,
) -> dict[str, Any]:
    """Build one browser request for a cell's current rendered output."""

    command = OutputCaptureCommand(
        protocol=COMMAND_PROTOCOL,
        version=PROTOCOL_VERSION,
        request_id=request_id,
        type="output.capture",
        payload=OutputCapturePayload(output_cell_id=cell_id),
    )
    return dump_model(command)


def is_response_envelope(content: object) -> bool:
    """Return whether a message belongs to the Lens response transport."""

    return isinstance(content, Mapping) and content.get("protocol") == RESPONSE_PROTOCOL


def parse_capture_response(
    content: object,
    buffers: Sequence[bytes | bytearray | memoryview],
) -> CaptureResponse:
    """Parse one browser capture reply."""

    if not isinstance(content, Mapping) or content.get("protocol") != RESPONSE_PROTOCOL:
        raise ProtocolError(
            "invalid_request",
            "Cell capture response must use the Lens response transport.",
        )
    response = _validate_model(
        CAPTURE_RESPONSE_ADAPTER,
        content,
        context="Cell capture response",
    )
    if isinstance(response, OutputCaptureSuccess):
        if len(buffers) != 1:
            raise ProtocolError(
                "invalid_buffers",
                "A successful cell capture requires exactly one PNG buffer.",
            )
        return CaptureResponse(
            cell_id=response.payload.output_cell_id,
            image=dump_model(response.payload.image),
            error_code=None,
            error=None,
        )

    assert isinstance(response, OutputCaptureFailure)
    _require_no_buffers(buffers)
    return CaptureResponse(
        cell_id=response.payload.output_cell_id,
        image=None,
        error_code=response.error.code,
        error=response.error.message,
    )


def snapshot_metadata(image: SelectionImage) -> dict[str, object]:
    """Project retained selection image metadata for browser transport."""

    values = {
        "id": image.id,
        "media_type": image.media_type,
        "width": image.width,
        "height": image.height,
        "sha256": image.sha256,
        "captured_at": image.captured_at,
    }
    snapshot = (
        OutdatedSnapshot(status="outdated", **values)
        if image.outdated
        else AvailableSnapshot(status="available", **values)
    )
    return dump_model(snapshot)


def success_response(
    *,
    request_id: str,
    revision: int,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    response = SuccessResponse(
        request_id=request_id,
        revision=revision,
        payload=dict(payload or {}),
    )
    return dump_model(response)


def error_response(
    *,
    request_id: str,
    revision: int,
    code: str,
    message: str,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    response = FailureResponse(
        request_id=utf16_text(request_id, 256),
        revision=revision,
        payload=dict(payload or {}),
        error=ErrorDetail(
            code=utf16_text(code, 128),
            message=utf16_text(message, MAX_ERROR),
        ),
    )
    return dump_model(response)


def request_id_from(content: object) -> str | None:
    """Return the request ID of a command, or None when it names none to answer."""

    if not isinstance(content, Mapping):
        return None
    try:
        return REQUEST_ID_ADAPTER.validate_python(content.get("requestId"))
    except ValidationError:
        return None


def _validate_model(
    adapter: TypeAdapter[_ModelT],
    value: object,
    *,
    context: str,
) -> _ModelT:
    try:
        return adapter.validate_python(value)
    except ValidationError as error:
        raise _protocol_error(error, context=context) from None


def _protocol_error(error: ValidationError, *, context: str) -> ProtocolError:
    detail = error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )[0]
    location = tuple(str(part) for part in detail.get("loc", ()))
    error_type = str(detail.get("type", ""))
    if error_type in _CUSTOM_ERROR_CODES:
        code = error_type
    elif "version" in location and error_type != "missing":
        code = "unsupported_version"
    elif error_type == "union_tag_invalid" and not location:
        code = "unsupported_command"
    elif "imageAction" in location:
        code = "invalid_image_action"
    elif "snapshot" in location or "image" in location:
        code = "invalid_image"
    elif "anchor" in location or "label" in location:
        code = "invalid_selection"
    else:
        code = "invalid_request"
    field = ".".join(location)
    prefix = f"{field} " if field else f"{context} "
    message = f"{prefix}{detail['msg']}"
    return ProtocolError(code, message[0].upper() + message[1:] + ".")


def _require_no_buffers(
    buffers: Sequence[bytes | bytearray | memoryview],
) -> None:
    if buffers:
        raise ProtocolError(
            "invalid_buffers",
            "This Lens message does not accept binary buffers.",
        )
