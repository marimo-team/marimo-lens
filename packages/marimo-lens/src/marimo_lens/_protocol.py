"""Validated browser transport for Lens selections and image capture."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from pydantic import TypeAdapter, ValidationError

from ._protocol_models import (
    CAPTURE_BROWSER_EVENT_ADAPTER,
    CAPTURE_RESPONSE_ADAPTER,
    COMMAND_ADAPTER,
    COMMAND_PROTOCOL,
    EVENT_PROTOCOL,
    MAX_ERROR,
    MAX_HISTORY,
    MAX_SELECTIONS,
    PROTOCOL_VERSION,
    REQUEST_ID_ADAPTER,
    RESPONSE_PROTOCOL,
    SELECTION_ADAPTER,
    SELECTION_ID_ADAPTER,
    AttentionActivityStartEvent,
    AttentionActivityStartPayload,
    AttentionActivityStopEvent,
    AttentionActivityStopPayload,
    AttentionAddress,
    AttentionRevealEvent,
    AttentionRevealPayload,
    AvailableSnapshot,
    ErrorDetail,
    FailureResponse,
    OutdatedSnapshot,
    OutputCaptureCommand,
    OutputCaptureFailure,
    OutputCapturePayload,
    OutputCaptureReady,
    OutputCaptureSuccess,
    PutSelectionCommand,
    ResolvedSelection,
    SelectionResolvedEvent,
    SelectionResolvedPayload,
    SnapshotResponsePayload,
    SuccessResponse,
    dump_model,
)

if TYPE_CHECKING:
    from ._images import _SelectionImage

CommandType = Literal[
    "selection.put",
    "selection.activate",
    "selection.delete",
    "selection.reopen",
    "selections.clear",
    "history.clear",
    "snapshot.get",
]
CaptureBrowserEvent = Literal["ready", "unready"]

_CUSTOM_ERROR_CODES = {
    "invalid_image",
    "invalid_image_action",
    "invalid_selection",
}
_ModelT = TypeVar("_ModelT")


class ProtocolError(ValueError):
    """Raised when a browser message violates the transport contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class Command:
    request_id: str
    type: CommandType
    payload: dict[str, Any]


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
) -> Command | None:
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

    return Command(
        request_id=command.request_id,
        type=cast(CommandType, command.type),
        payload=dump_model(command.payload),
    )


def capture_command(
    *,
    request_id: str,
    cell_id: str,
) -> dict[str, Any]:
    """Build one browser request for a cell's current rendered output."""

    try:
        command = OutputCaptureCommand(
            protocol=COMMAND_PROTOCOL,
            version=PROTOCOL_VERSION,
            request_id=request_id,
            type="output.capture",
            payload=OutputCapturePayload(output_cell_id=cell_id),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Output capture command") from None
    return dump_model(command)


def is_response_envelope(content: object) -> bool:
    """Return whether a message belongs to the Lens response transport."""

    return isinstance(content, Mapping) and content.get("protocol") == RESPONSE_PROTOCOL


def attention_reveal_event(
    *,
    address: AttentionAddress,
    label: str | None,
    message: str | None,
    duration_ms: int,
) -> dict[str, Any]:
    """Build one transient request to reveal an addressed target."""

    try:
        event = AttentionRevealEvent(
            payload=AttentionRevealPayload(
                address=address,
                label=label,
                message=message,
                duration_ms=duration_ms,
            ),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Attention reveal event") from None
    return dump_model(event)


def attention_activity_start_event(
    *,
    activity_id: str,
    address: AttentionAddress,
    duration_ms: int | None,
    label: str | None,
    message: str | None,
) -> dict[str, Any]:
    """Build one transient request to mark active work on an addressed target."""

    try:
        event = AttentionActivityStartEvent(
            payload=AttentionActivityStartPayload(
                activity_id=activity_id,
                address=address,
                duration_ms=duration_ms,
                label=label,
                message=message,
            ),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Attention activity start event") from None
    return dump_model(event)


def attention_activity_stop_event(
    *,
    activity_id: str,
) -> dict[str, Any]:
    """Build one transient request to stop its matching activity owner."""

    try:
        event = AttentionActivityStopEvent(
            payload=AttentionActivityStopPayload(activity_id=activity_id),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Attention activity stop event") from None
    return dump_model(event)


def selection_resolved_event(
    *,
    selections: Sequence[Mapping[str, Any]],
    summary: str | None,
    revision: int,
) -> dict[str, Any]:
    """Build one transient receipt for one atomic resolution."""

    try:
        event = SelectionResolvedEvent(
            revision=revision,
            payload=SelectionResolvedPayload(
                selections=tuple(
                    ResolvedSelection.model_validate(selection)
                    for selection in selections
                ),
                summary=summary,
            ),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Selection resolution event") from None
    return dump_model(event)


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


def mutation_ack_response(
    *,
    request_id: str,
    revision: int,
    selection_id: str | None = None,
) -> dict[str, Any]:
    """Build an acknowledgement for a committed selection mutation."""

    payload: dict[str, str] = {}
    if selection_id is not None:
        try:
            payload["selectionId"] = SELECTION_ID_ADAPTER.validate_python(selection_id)
        except ValidationError as error:
            raise _protocol_error(error, context="Selection response") from None
    return success_response(
        request_id=request_id,
        revision=revision,
        payload=payload,
    )


def selection_put_response(
    *,
    request_id: str,
    revision: int,
    selection: Mapping[str, Any],
) -> dict[str, Any]:
    """Build the committed selection returned by ``selection.put``."""

    try:
        selected = SELECTION_ADAPTER.validate_python(selection)
    except ValidationError as error:
        raise _protocol_error(error, context="Selection response") from None
    return success_response(
        request_id=request_id,
        revision=revision,
        payload={"selection": dump_model(selected)},
    )


def snapshot_metadata(image: _SelectionImage) -> dict[str, object]:
    """Project retained selection image metadata for browser transport."""

    try:
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
    except ValidationError as error:
        raise _protocol_error(error, context="Selection snapshot") from None
    return dump_model(snapshot)


def snapshot_response(
    *,
    request_id: str,
    revision: int,
    selection_id: str,
    image: _SelectionImage,
) -> tuple[dict[str, Any], tuple[bytes, ...]]:
    """Build a snapshot response and its exact retained PNG buffer."""

    metadata = snapshot_metadata(image)
    try:
        payload = SnapshotResponsePayload.model_validate(
            {"selectionId": selection_id, "snapshot": metadata}
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Snapshot response") from None
    response = success_response(
        request_id=request_id,
        revision=revision,
        payload=dump_model(payload),
    )
    return response, (image.data,)


def success_response(
    *,
    request_id: str,
    revision: int,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        response = SuccessResponse(
            request_id=request_id,
            revision=revision,
            payload=dict(payload or {}),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Lens response") from None
    return dump_model(response)


def error_response(
    *,
    request_id: str,
    revision: int,
    code: str,
    message: str,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        response = FailureResponse(
            request_id=_response_text(request_id, 256),
            revision=revision,
            payload=dict(payload or {}),
            error=ErrorDetail(
                code=_response_text(code, 128),
                message=_response_text(message, MAX_ERROR),
            ),
        )
    except ValidationError as error:
        raise _protocol_error(error, context="Lens error response") from None
    return dump_model(response)


def request_id_from(content: object) -> str:
    if not isinstance(content, Mapping):
        return ""
    try:
        return REQUEST_ID_ADAPTER.validate_python(content.get("requestId"))
    except ValidationError:
        return ""


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


def _response_text(value: str, maximum: int) -> str:
    """Return valid text bounded by the browser's UTF-16 length contract."""

    result: list[str] = []
    length = 0
    for character in value:
        codepoint = ord(character)
        if 0xD800 <= codepoint <= 0xDFFF:
            character = "\N{REPLACEMENT CHARACTER}"
            width = 1
        else:
            width = 2 if codepoint > 0xFFFF else 1
        if length + width > maximum:
            break
        result.append(character)
        length += width
    return "".join(result)


def _require_no_buffers(
    buffers: Sequence[bytes | bytearray | memoryview],
) -> None:
    if buffers:
        raise ProtocolError(
            "invalid_buffers",
            "This Lens message does not accept binary buffers.",
        )


__all__ = [
    "MAX_HISTORY",
    "MAX_SELECTIONS",
    "CaptureResponse",
    "Command",
    "ProtocolError",
    "attention_activity_start_event",
    "attention_activity_stop_event",
    "attention_reveal_event",
    "capture_command",
    "error_response",
    "is_response_envelope",
    "mutation_ack_response",
    "parse_capture_browser_event",
    "parse_capture_response",
    "parse_command",
    "request_id_from",
    "selection_put_response",
    "selection_resolved_event",
    "snapshot_metadata",
    "snapshot_response",
    "success_response",
]
