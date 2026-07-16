"""Strict browser command protocol for Lens selections and context."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast

COMMAND_PROTOCOL = "marimo-lens.command"
RESPONSE_PROTOCOL = "marimo-lens.response"
PROTOCOL_VERSION = 1

MAX_SELECTIONS = 64
MAX_SELECTION_ID = 128
MAX_NOTE = 4_000
MAX_DOM_TEXT = 240
MAX_DOM_FIELD = 240
MAX_ERROR = 500

CommandType = Literal[
    "selection.put",
    "selection.activate",
    "selection.delete",
    "selections.clear",
    "context.export",
    "snapshot.get",
]
ContextExportFormat = Literal["current", "references", "text"]
ImageAction = Literal["preserve", "replace", "clear"]

_COMMAND_TYPES = {
    "selection.put",
    "selection.activate",
    "selection.delete",
    "selections.clear",
    "context.export",
    "snapshot.get",
}
_CONTEXT_EXPORT_FORMATS = {"current", "references", "text"}
_IMAGE_ACTIONS = {"preserve", "replace", "clear"}
_LABEL = re.compile(r"S[1-9][0-9]*\Z")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class ProtocolError(ValueError):
    """Raised when a browser command violates the command contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class Command:
    request_id: str
    type: CommandType
    payload: dict[str, Any]


def parse_command(
    content: object,
    buffers: Sequence[bytes | bytearray | memoryview],
) -> Command | None:
    """Parse one Lens command or ignore an envelope owned by another feature."""

    if not isinstance(content, Mapping) or content.get("protocol") != COMMAND_PROTOCOL:
        return None
    command_mapping = cast(Mapping[str, Any], content)

    _exact_keys(
        command_mapping,
        required={"protocol", "version", "requestId", "type", "payload"},
        field="command",
    )
    if (
        type(content.get("version")) is not int
        or content.get("version") != PROTOCOL_VERSION
    ):
        raise ProtocolError(
            "unsupported_version",
            f"Lens command protocol version must be {PROTOCOL_VERSION}.",
        )

    request_id = _string(
        content.get("requestId"),
        field="requestId",
        maximum=256,
    )
    raw_type = content.get("type")
    if not isinstance(raw_type, str) or raw_type not in _COMMAND_TYPES:
        raise ProtocolError(
            "unsupported_command",
            "Lens command type is not supported.",
        )
    command_type = cast(CommandType, raw_type)
    payload = _object(content.get("payload"), field="payload")

    if command_type == "selection.put":
        canonical_payload = _parse_put(payload, buffers)
    elif command_type in {"selection.activate", "selection.delete"}:
        _require_no_buffers(buffers)
        _exact_keys(
            payload,
            required={"selectionId", "expectedRevision"},
            field="payload",
        )
        canonical_payload = {
            "selectionId": _string(
                payload.get("selectionId"),
                field="selectionId",
                maximum=MAX_SELECTION_ID,
            ),
            "expectedRevision": _revision(payload.get("expectedRevision")),
        }
    elif command_type == "selections.clear":
        _require_no_buffers(buffers)
        _exact_keys(payload, required={"expectedRevision"}, field="payload")
        canonical_payload = {
            "expectedRevision": _revision(payload.get("expectedRevision"))
        }
    elif command_type == "context.export":
        _require_no_buffers(buffers)
        _exact_keys(payload, required={"format"}, field="payload")
        export_format = payload.get("format")
        if (
            not isinstance(export_format, str)
            or export_format not in _CONTEXT_EXPORT_FORMATS
        ):
            raise ProtocolError(
                "invalid_export_format",
                "Context export format must be current, references, or text.",
            )
        canonical_payload = {
            "format": cast(ContextExportFormat, export_format),
        }
    elif command_type == "snapshot.get":
        _require_no_buffers(buffers)
        _exact_keys(payload, required={"selectionId"}, field="payload")
        canonical_payload = {
            "selectionId": _string(
                payload.get("selectionId"),
                field="selectionId",
                maximum=MAX_SELECTION_ID,
            )
        }
    else:
        raise ProtocolError(
            "unsupported_command",
            "Lens command type is not supported.",
        )

    return Command(
        request_id=request_id,
        type=command_type,
        payload=canonical_payload,
    )


def success_response(
    *,
    request_id: str,
    revision: int,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "protocol": RESPONSE_PROTOCOL,
        "version": PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": True,
        "revision": revision,
        "payload": dict(payload or {}),
    }


def error_response(
    *,
    request_id: str,
    revision: int,
    code: str,
    message: str,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "protocol": RESPONSE_PROTOCOL,
        "version": PROTOCOL_VERSION,
        "requestId": _response_text(request_id, 256),
        "ok": False,
        "revision": revision,
        "payload": dict(payload or {}),
        "error": {
            "code": _response_text(code, 128),
            "message": _response_text(message, MAX_ERROR),
        },
    }


def request_id_from(content: object) -> str:
    if not isinstance(content, Mapping):
        return ""
    try:
        return _string(content.get("requestId"), field="requestId", maximum=256)
    except ProtocolError:
        return ""


def _parse_put(
    payload: Mapping[str, Any],
    buffers: Sequence[bytes | bytearray | memoryview],
) -> dict[str, Any]:
    _exact_keys(
        payload,
        required={"selection", "expectedRevision", "imageAction"},
        field="payload",
    )
    expected_revision = _revision(payload.get("expectedRevision"))
    image_action = payload.get("imageAction")
    if not isinstance(image_action, str) or image_action not in _IMAGE_ACTIONS:
        raise ProtocolError(
            "invalid_image_action",
            "imageAction must be preserve, replace, or clear.",
        )
    if image_action == "replace":
        if len(buffers) != 1:
            raise ProtocolError(
                "invalid_buffers",
                "Replacing a selection image requires exactly one PNG buffer.",
            )
    else:
        _require_no_buffers(buffers)

    selection = _parse_selection(_object(payload.get("selection"), field="selection"))
    snapshot_status = selection["snapshot"]["status"]
    if image_action == "replace" and snapshot_status != "available":
        raise ProtocolError(
            "invalid_image_action",
            "Replacing a selection image requires available snapshot metadata.",
        )
    if image_action == "clear" and snapshot_status not in {"pending", "failed"}:
        raise ProtocolError(
            "invalid_image_action",
            "Clearing a selection image requires pending or failed metadata.",
        )
    return {
        "selection": selection,
        "expectedRevision": expected_revision,
        "imageAction": image_action,
    }


def _parse_selection(value: Mapping[str, Any]) -> dict[str, Any]:
    _exact_keys(
        value,
        required={
            "id",
            "label",
            "note",
            "outputCellId",
            "createdAt",
            "anchor",
            "snapshot",
        },
        optional={"domHint"},
        field="selection",
    )
    selection_id = _string(
        value.get("id"),
        field="selection.id",
        maximum=MAX_SELECTION_ID,
    )
    label = _string(value.get("label"), field="selection.label", maximum=16)
    if _LABEL.fullmatch(label) is None:
        raise ProtocolError(
            "invalid_selection",
            "Selection label must use the S1, S2, S3 format.",
        )
    note = _string(
        value.get("note"),
        field="selection.note",
        maximum=MAX_NOTE,
        allow_empty=True,
    )

    result: dict[str, Any] = {
        "id": selection_id,
        "label": label,
        "note": note,
        "outputCellId": _string(
            value.get("outputCellId"),
            field="selection.outputCellId",
            maximum=128,
        ),
        "createdAt": _timestamp(value.get("createdAt"), field="selection.createdAt"),
        "anchor": _anchor(_object(value.get("anchor"), field="selection.anchor")),
        "snapshot": _snapshot(
            _object(value.get("snapshot"), field="selection.snapshot")
        ),
    }
    if "domHint" in value:
        result["domHint"] = _dom_hint(
            _object(value.get("domHint"), field="selection.domHint")
        )
    snapshot = result["snapshot"]
    if (
        snapshot["status"] in {"available", "outdated"}
        and snapshot["id"] != f"image:{selection_id}"
    ):
        raise ProtocolError(
            "invalid_image",
            "Selection image id must be image:<selection-id>.",
        )
    return result


def _anchor(value: Mapping[str, Any]) -> dict[str, Any]:
    kind = value.get("kind")
    if kind == "point":
        _exact_keys(value, required={"kind", "x", "y"}, field="anchor")
        return {
            "kind": "point",
            "x": _unit(value.get("x"), field="anchor.x"),
            "y": _unit(value.get("y"), field="anchor.y"),
        }
    if kind == "rect":
        _exact_keys(
            value,
            required={"kind", "x", "y", "width", "height"},
            field="anchor",
        )
        x = _unit(value.get("x"), field="anchor.x")
        y = _unit(value.get("y"), field="anchor.y")
        width = _positive_unit(value.get("width"), field="anchor.width")
        height = _positive_unit(value.get("height"), field="anchor.height")
        if x + width > 1 or y + height > 1:
            raise ProtocolError(
                "invalid_selection",
                "Selection rectangle must stay inside its output.",
            )
        return {
            "kind": "rect",
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
    raise ProtocolError(
        "invalid_selection",
        "Selection anchor kind must be point or rect.",
    )


def _dom_hint(value: Mapping[str, Any]) -> dict[str, Any]:
    string_fields = {"tag", "role", "ariaLabel", "title", "text", "path"}
    _exact_keys(
        value,
        required={"tag"},
        optional=(string_fields - {"tag"}) | {"bounds"},
        field="domHint",
    )
    result: dict[str, Any] = {}
    for field in string_fields:
        if field not in value:
            continue
        maximum = MAX_DOM_TEXT if field == "text" else MAX_DOM_FIELD
        result[field] = _string(
            value.get(field),
            field=f"domHint.{field}",
            maximum=maximum,
            allow_empty=field != "tag",
        )
    if "bounds" in value:
        bounds = _object(value.get("bounds"), field="domHint.bounds")
        _exact_keys(
            bounds,
            required={"x", "y", "width", "height"},
            field="domHint.bounds",
        )
        x = _unit(bounds.get("x"), field="domHint.bounds.x")
        y = _unit(bounds.get("y"), field="domHint.bounds.y")
        width = _unit(bounds.get("width"), field="domHint.bounds.width")
        height = _unit(bounds.get("height"), field="domHint.bounds.height")
        if x + width > 1 or y + height > 1:
            raise ProtocolError(
                "invalid_selection",
                "DOM hint bounds must stay inside their output.",
            )
        result["bounds"] = {
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
    return result


def _snapshot(value: Mapping[str, Any]) -> dict[str, Any]:
    status = value.get("status")
    if status in {"available", "outdated"}:
        _exact_keys(
            value,
            required={
                "status",
                "id",
                "mediaType",
                "width",
                "height",
                "sha256",
                "capturedAt",
            },
            field="snapshot",
        )
        if value.get("mediaType") != "image/png":
            raise ProtocolError(
                "invalid_image",
                "Selection image mediaType must be image/png.",
            )
        width = _positive_integer(value.get("width"), field="snapshot.width")
        height = _positive_integer(value.get("height"), field="snapshot.height")
        digest = _string(value.get("sha256"), field="snapshot.sha256", maximum=64)
        if _SHA256.fullmatch(digest) is None:
            raise ProtocolError(
                "invalid_image",
                "Selection image sha256 must be a lowercase hexadecimal digest.",
            )
        return {
            "status": status,
            "id": _string(
                value.get("id"),
                field="snapshot.id",
                maximum=len("image:") + MAX_SELECTION_ID,
            ),
            "mediaType": "image/png",
            "width": width,
            "height": height,
            "sha256": digest,
            "capturedAt": _timestamp(
                value.get("capturedAt"), field="snapshot.capturedAt"
            ),
        }
    if status == "failed":
        _exact_keys(
            value,
            required={"status", "capturedAt"},
            optional={"error"},
            field="snapshot",
        )
        result = {
            "status": "failed",
            "capturedAt": _timestamp(
                value.get("capturedAt"), field="snapshot.capturedAt"
            ),
        }
        if "error" in value:
            result["error"] = _string(
                value.get("error"),
                field="snapshot.error",
                maximum=MAX_ERROR,
                allow_empty=True,
            )
        return result
    if status == "pending":
        _exact_keys(value, required={"status"}, field="snapshot")
        return {"status": status}
    raise ProtocolError(
        "invalid_image",
        "Selection snapshot status must be pending, available, failed, or outdated.",
    )


def _object(value: object, *, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or any(not isinstance(key, str) for key in value):
        raise ProtocolError("invalid_request", f"{field} must be an object.")
    return cast(Mapping[str, Any], value)


def _exact_keys(
    value: Mapping[str, Any],
    *,
    required: set[str],
    field: str,
    optional: set[str] | None = None,
) -> None:
    keys = set(value)
    allowed = required | (optional or set())
    if not required <= keys or not keys <= allowed:
        raise ProtocolError(
            "invalid_request",
            f"{field} fields do not match the protocol contract.",
        )


def _string(
    value: object,
    *,
    field: str,
    maximum: int,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ProtocolError("invalid_request", f"{field} must be a string.")
    if not allow_empty and not value:
        raise ProtocolError("invalid_request", f"{field} must not be empty.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ProtocolError(
            "invalid_request",
            f"{field} must contain valid Unicode text.",
        ) from error
    length = len(value.encode("utf-16-le", errors="surrogatepass")) // 2
    if length > maximum:
        raise ProtocolError(
            "invalid_request",
            f"{field} must not exceed {maximum} characters.",
        )
    return value


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


def _timestamp(value: object, *, field: str) -> str:
    timestamp = _string(value, field=field, maximum=64)
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProtocolError(
            "invalid_request",
            f"{field} must be an ISO 8601 timestamp.",
        ) from error
    if parsed.tzinfo is None:
        raise ProtocolError(
            "invalid_request",
            f"{field} must include a UTC offset.",
        )
    return timestamp


def _unit(value: object, *, field: str) -> float:
    number = _number(value, field=field)
    if number < 0 or number > 1:
        raise ProtocolError("invalid_selection", f"{field} must be between 0 and 1.")
    return number


def _positive_unit(value: object, *, field: str) -> float:
    number = _unit(value, field=field)
    if number <= 0:
        raise ProtocolError("invalid_selection", f"{field} must be positive.")
    return number


def _number(value: object, *, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProtocolError("invalid_request", f"{field} must be a number.")
    try:
        number = float(value)
    except OverflowError as error:
        raise ProtocolError("invalid_request", f"{field} must be finite.") from error
    if not math.isfinite(number):
        raise ProtocolError("invalid_request", f"{field} must be finite.")
    return number


def _positive_integer(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ProtocolError("invalid_request", f"{field} must be a positive integer.")
    return value


def _revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ProtocolError(
            "invalid_request",
            "expectedRevision must be a non-negative integer.",
        )
    return value


def _require_no_buffers(
    buffers: Sequence[bytes | bytearray | memoryview],
) -> None:
    if buffers:
        raise ProtocolError(
            "invalid_buffers",
            "This Lens command does not accept binary buffers.",
        )


__all__ = [
    "Command",
    "ProtocolError",
    "error_response",
    "parse_command",
    "request_id_from",
    "success_response",
]
