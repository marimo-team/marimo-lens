"""Pydantic models for Lens browser messages."""

from __future__ import annotations

import re
from functools import partial
from typing import Annotated, Any, Literal, TypeAlias

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_serializer,
    model_validator,
)
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError
from typing_extensions import Self

COMMAND_PROTOCOL = "marimo-lens.command"
RESPONSE_PROTOCOL = "marimo-lens.response"
EVENT_PROTOCOL = "marimo-lens.event"
PROTOCOL_VERSION = 6

MAX_SELECTIONS = 64
MAX_HISTORY = 64
MAX_SELECTION_ID = 128
MAX_CELL_ID = 128
MAX_NOTE = 4_000
MAX_DOM_TEXT = 240
MAX_DOM_FIELD = 240
MAX_DOM_SELECTOR = 1_024
MAX_ERROR = 500
MAX_ATTENTION_MESSAGE = 240
MAX_REVEAL_MESSAGE = 1_000
MAX_ATTENTION_LABEL = 40
MAX_ATTENTION_DURATION_MS = 300_000
MAX_TRAIL_STEPS = 16
MAX_SAFE_INTEGER = 9_007_199_254_740_991

_TIMESTAMP_PATTERN = (
    r"^(?:\d{4})-(?:\d{2})-(?:\d{2})T(?:\d{2}):(?:\d{2}):(?:\d{2})"
    r"(?:\.\d+)?(?:Z|[+-](?:\d{2}):(?:\d{2}))$"
)
_PROTOCOL_EDGE_WHITESPACE = re.compile(r"^[\s\ufeff]+|[\s\ufeff]+$")
_AWARE_DATETIME_ADAPTER = TypeAdapter(AwareDatetime)


def _valid_unicode(value: str) -> str:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise PydanticCustomError(
            "unicode_text",
            "must contain valid Unicode text",
        ) from error
    return value


def _nonblank(value: str) -> str:
    if all(character.isspace() or character == "\ufeff" for character in value):
        raise PydanticCustomError("text_blank", "must not be empty")
    return value


def _bounded_utf16(value: str, *, maximum: int) -> str:
    if len(value.encode("utf-16-le")) // 2 > maximum:
        raise PydanticCustomError(
            "utf16_too_long",
            "must contain at most {maximum} UTF-16 code units",
            {"maximum": maximum},
        )
    return value


def _valid_timestamp(value: str) -> str:
    try:
        _AWARE_DATETIME_ADAPTER.validate_python(value)
    except ValidationError as error:
        raise PydanticCustomError(
            "timestamp",
            "must be an ISO 8601 timestamp with a UTC offset",
        ) from error
    return value


def _optional_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    trimmed = _PROTOCOL_EDGE_WHITESPACE.sub("", value)
    return trimmed or None


UnicodeText: TypeAlias = Annotated[
    str,
    StringConstraints(strict=True),
    AfterValidator(_valid_unicode),
]
Identifier: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_SELECTION_ID)),
]
CellId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_CELL_ID)),
]
RequestId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=256)),
]
SelectionLabel: TypeAlias = Annotated[
    UnicodeText,
    StringConstraints(pattern=r"^S[1-9][0-9]*$"),
    AfterValidator(partial(_bounded_utf16, maximum=16)),
]
NoteText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(_bounded_utf16, maximum=MAX_NOTE)),
]
DomFieldText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(_bounded_utf16, maximum=MAX_DOM_FIELD)),
]
DomContentText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(_bounded_utf16, maximum=MAX_DOM_TEXT)),
]
DomSelectorText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_DOM_SELECTOR)),
]
ErrorText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(_bounded_utf16, maximum=MAX_ERROR)),
]
NonEmptyErrorText: TypeAlias = Annotated[ErrorText, AfterValidator(_nonblank)]
AttentionText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_ATTENTION_MESSAGE)),
]
OptionalAttentionText: TypeAlias = Annotated[
    AttentionText | None,
    BeforeValidator(_optional_text),
]
RevealText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_REVEAL_MESSAGE)),
]
OptionalRevealText: TypeAlias = Annotated[
    RevealText | None,
    BeforeValidator(_optional_text),
]
AttentionLabel: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=MAX_ATTENTION_LABEL)),
]
OptionalAttentionLabel: TypeAlias = Annotated[
    AttentionLabel | None,
    BeforeValidator(_optional_text),
]
TimestampText: TypeAlias = Annotated[
    UnicodeText,
    StringConstraints(
        min_length=1,
        pattern=_TIMESTAMP_PATTERN,
    ),
    AfterValidator(partial(_bounded_utf16, maximum=64)),
    AfterValidator(_valid_timestamp),
]
Sha256: TypeAlias = Annotated[
    str,
    StringConstraints(strict=True, pattern=r"^[a-f0-9]{64}$"),
]
NormalizedNumber: TypeAlias = Annotated[
    float,
    Field(strict=True, ge=0, le=1, allow_inf_nan=False),
]
PositiveNormalizedNumber: TypeAlias = Annotated[
    float,
    Field(strict=True, gt=0, le=1, allow_inf_nan=False),
]
PositiveSafeInteger: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=1, le=MAX_SAFE_INTEGER),
]
NonNegativeSafeInteger: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=0, le=MAX_SAFE_INTEGER),
]
AttentionDuration: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=1, le=MAX_ATTENTION_DURATION_MS),
]
Revision: TypeAlias = NonNegativeSafeInteger
ProtocolVersion: TypeAlias = Annotated[
    int,
    Field(
        strict=True,
        ge=PROTOCOL_VERSION,
        le=PROTOCOL_VERSION,
    ),
]
SelectionImageId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=len("image:") + MAX_SELECTION_ID)),
]
OutputImageId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=len("image:") + 256)),
]
ErrorCode: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(_nonblank),
    AfterValidator(partial(_bounded_utf16, maximum=128)),
]


class TransportModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        strict=True,
    )


class PointAnchor(TransportModel):
    kind: Literal["point"]
    x: NormalizedNumber
    y: NormalizedNumber


class RectAnchor(TransportModel):
    kind: Literal["rect"]
    x: NormalizedNumber
    y: NormalizedNumber
    width: PositiveNormalizedNumber
    height: PositiveNormalizedNumber

    @model_validator(mode="after")
    def inside_target(self) -> Self:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise PydanticCustomError(
                "invalid_selection",
                "Selection rectangle must stay inside its target",
            )
        return self


SelectionAnchor: TypeAlias = Annotated[
    PointAnchor | RectAnchor,
    Field(discriminator="kind"),
]


class DomBounds(TransportModel):
    x: NormalizedNumber
    y: NormalizedNumber
    width: NormalizedNumber
    height: NormalizedNumber

    @model_validator(mode="after")
    def inside_target(self) -> Self:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise PydanticCustomError(
                "invalid_selection",
                "DOM hint bounds must stay inside their target",
            )
        return self


class DomHint(TransportModel):
    tag: Annotated[DomFieldText, AfterValidator(_nonblank)]
    role: DomFieldText | None = None
    aria_label: DomFieldText | None = None
    title: DomFieldText | None = None
    text: DomContentText | None = None
    path: DomFieldText | None = None
    bounds: DomBounds | None = None


class SelectionTargetBase(TransportModel):
    cell_ids: Annotated[list[CellId], Field(max_length=64)]
    document_id: Identifier

    @field_validator("cell_ids")
    @classmethod
    def canonical_cell_ids(cls, cell_ids: list[CellId]) -> list[CellId]:
        if len(set(cell_ids)) != len(cell_ids):
            raise PydanticCustomError(
                "invalid_target",
                "Target cell ids must be unique",
            )
        return sorted(cell_ids)


class NotebookSelectionTarget(SelectionTargetBase):
    kind: Literal["notebook"]
    document_path: DomSelectorText

    @model_validator(mode="after")
    def one_cell(self) -> Self:
        if len(self.cell_ids) != 1:
            raise PydanticCustomError(
                "invalid_target",
                "Notebook targets require one cell id",
            )
        return self


class NotebookSource(TransportModel):
    model_config = ConfigDict(extra="forbid")

    cell_id: CellId
    selector: (
        Annotated[
            UnicodeText,
            AfterValidator(_nonblank),
            AfterValidator(partial(_bounded_utf16, maximum=4_096)),
        ]
        | None
    )

    @model_serializer
    def serialize_source(self) -> dict[str, str | None]:
        """Keep required nulls when enclosing messages omit optional fields."""
        return {
            "cellId": self.cell_id,
            "selector": self.selector,
        }


class DomSelectionTarget(SelectionTargetBase):
    kind: Literal["dom"]
    sources: Annotated[list[NotebookSource], Field(max_length=64)]
    document_path: DomSelectorText
    dom_selector: DomSelectorText

    @model_validator(mode="after")
    def source_cells(self) -> Self:
        if any(source.cell_id not in self.cell_ids for source in self.sources):
            raise ValueError("Notebook sources must belong to the target cells")
        return self


SelectionTarget: TypeAlias = Annotated[
    NotebookSelectionTarget | DomSelectionTarget,
    Field(discriminator="kind"),
]


class PendingSnapshot(TransportModel):
    status: Literal["pending"]


class PngMetadata(TransportModel):
    media_type: Literal["image/png"]
    width: PositiveSafeInteger
    height: PositiveSafeInteger
    sha256: Sha256
    captured_at: TimestampText


class AvailableSnapshot(PngMetadata):
    status: Literal["available"]
    id: SelectionImageId


class OutdatedSnapshot(PngMetadata):
    status: Literal["outdated"]
    id: SelectionImageId


class FailedSnapshot(TransportModel):
    status: Literal["failed"]
    captured_at: TimestampText
    error: ErrorText | None = None


SelectionSnapshot: TypeAlias = Annotated[
    PendingSnapshot | AvailableSnapshot | OutdatedSnapshot | FailedSnapshot,
    Field(discriminator="status"),
]


class RenderSource(TransportModel):
    model_config = ConfigDict(extra="forbid")

    path: DomSelectorText
    line: PositiveSafeInteger | None = None
    column: PositiveSafeInteger | None = None
    symbol: (
        Annotated[
            UnicodeText,
            AfterValidator(_nonblank),
            AfterValidator(partial(_bounded_utf16, maximum=256)),
        ]
        | None
    ) = None


class TargetInfo(TransportModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[
        UnicodeText,
        AfterValidator(_nonblank),
        AfterValidator(partial(_bounded_utf16, maximum=256)),
    ]
    detail: (
        Annotated[
            UnicodeText,
            AfterValidator(_nonblank),
            AfterValidator(partial(_bounded_utf16, maximum=512)),
        ]
        | None
    ) = None
    render_source: RenderSource | None = None


class SelectionInput(TransportModel):
    id: Identifier
    label: SelectionLabel
    note: NoteText
    target: SelectionTarget
    created_at: TimestampText
    anchor: SelectionAnchor
    dom_hint: DomHint | None = None
    description: TargetInfo
    snapshot: SelectionSnapshot

    @model_validator(mode="after")
    def image_identifies_selection(self) -> Self:
        if isinstance(self.snapshot, (AvailableSnapshot, OutdatedSnapshot)) and (
            self.snapshot.id != f"image:{self.id}"
        ):
            raise PydanticCustomError(
                "invalid_image",
                "Selection image id must be image:<selection-id>",
            )
        return self


class PreviousResolution(TransportModel):
    addressed_at: TimestampText
    summary: AttentionText | None = None


class Selection(SelectionInput):
    previous_resolution: PreviousResolution | None = None


class AddressedSelection(TransportModel):
    selection_id: Identifier
    label: SelectionLabel
    note: NoteText
    target: SelectionTarget
    created_at: TimestampText
    addressed_at: TimestampText
    anchor: SelectionAnchor
    dom_hint: DomHint | None = None
    description: TargetInfo
    summary: AttentionText | None = None
    resolution_revision: Revision


ImageAction = Literal["preserve", "replace", "clear"]


class PutSelectionPayload(TransportModel):
    selection: SelectionInput
    expected_revision: Revision
    image_action: ImageAction

    @model_validator(mode="after")
    def image_action_matches_snapshot(self) -> Self:
        status = self.selection.snapshot.status
        if self.image_action == "replace" and status != "available":
            raise PydanticCustomError(
                "invalid_image_action",
                "Replacing a selection image requires available snapshot metadata",
            )
        if self.image_action == "clear" and status not in {"pending", "failed"}:
            raise PydanticCustomError(
                "invalid_image_action",
                "Clearing a selection image requires pending or failed metadata",
            )
        return self


class SelectionMutationPayload(TransportModel):
    selection_id: Identifier
    expected_revision: Revision


class ClearSelectionsPayload(TransportModel):
    expected_revision: Revision


class ReopenSelectionPayload(SelectionMutationPayload):
    resolution_revision: Revision


class ClearHistoryPayload(TransportModel):
    expected_revision: Revision


class SnapshotRequestPayload(TransportModel):
    selection_id: Identifier


class CommandBase(TransportModel):
    protocol: Literal["marimo-lens.command"]
    version: ProtocolVersion
    request_id: RequestId


class PutSelectionCommand(CommandBase):
    type: Literal["selection.put"]
    payload: PutSelectionPayload


class ActivateSelectionCommand(CommandBase):
    type: Literal["selection.activate"]
    payload: SelectionMutationPayload


class DeleteSelectionCommand(CommandBase):
    type: Literal["selection.delete"]
    payload: SelectionMutationPayload


class ClearSelectionsCommand(CommandBase):
    type: Literal["selections.clear"]
    payload: ClearSelectionsPayload


class ReopenSelectionCommand(CommandBase):
    type: Literal["selection.reopen"]
    payload: ReopenSelectionPayload


class ClearHistoryCommand(CommandBase):
    type: Literal["history.clear"]
    payload: ClearHistoryPayload


class GetSnapshotCommand(CommandBase):
    type: Literal["snapshot.get"]
    payload: SnapshotRequestPayload


ClientCommand: TypeAlias = Annotated[
    PutSelectionCommand
    | ActivateSelectionCommand
    | DeleteSelectionCommand
    | ClearSelectionsCommand
    | ReopenSelectionCommand
    | ClearHistoryCommand
    | GetSnapshotCommand,
    Field(discriminator="type"),
]


class OutputCapturePayload(TransportModel):
    output_cell_id: CellId


class OutputCaptureCommand(CommandBase):
    type: Literal["output.capture"]
    payload: OutputCapturePayload


class OutputCaptureImage(PngMetadata):
    status: Literal["available"]
    id: OutputImageId


class OutputCaptureSuccessPayload(TransportModel):
    output_cell_id: CellId
    image: OutputCaptureImage


class OutputCaptureFailurePayload(TransportModel):
    output_cell_id: CellId


class ErrorDetail(TransportModel):
    code: ErrorCode
    message: NonEmptyErrorText


class CaptureResponseBase(TransportModel):
    protocol: Literal["marimo-lens.response"]
    version: ProtocolVersion
    request_id: RequestId
    revision: Revision


class OutputCaptureSuccess(CaptureResponseBase):
    ok: Literal[True]
    payload: OutputCaptureSuccessPayload

    @model_validator(mode="after")
    def image_identifies_request(self) -> Self:
        if self.payload.image.id != f"image:{self.request_id}":
            raise PydanticCustomError(
                "invalid_image",
                "Cell capture image id must identify its request",
            )
        return self


class OutputCaptureFailure(CaptureResponseBase):
    ok: Literal[False]
    payload: OutputCaptureFailurePayload
    error: ErrorDetail


OutputCaptureResponse: TypeAlias = Annotated[
    OutputCaptureSuccess | OutputCaptureFailure,
    Field(discriminator="ok"),
]


class BrowserEventBase(TransportModel):
    protocol: Literal["marimo-lens.event"]
    version: ProtocolVersion
    payload: dict[str, Any]


class OutputCaptureReady(BrowserEventBase):
    type: Literal["output.capture.ready"]


class OutputCaptureUnready(BrowserEventBase):
    type: Literal["output.capture.unready"]


CaptureBrowserMessage: TypeAlias = Annotated[
    OutputCaptureReady | OutputCaptureUnready,
    Field(discriminator="type"),
]


class CellAttentionAddress(TransportModel):
    kind: Literal["cell"]
    cell_id: CellId


class SelectionAttentionAddress(TransportModel):
    kind: Literal["selection"]
    selection_id: Identifier
    revision: Revision


AttentionAddress: TypeAlias = Annotated[
    CellAttentionAddress | SelectionAttentionAddress,
    Field(discriminator="kind"),
]


class TrailStep(TransportModel):
    address: AttentionAddress
    label: AttentionLabel | None = None
    message: RevealText | None = None


class Trail(TransportModel):
    id: Identifier
    steps: Annotated[list[TrailStep], Field(min_length=1, max_length=MAX_TRAIL_STEPS)]
    duration_ms: AttentionDuration | None = None


class AttentionRevealEvent(TransportModel):
    protocol: Literal["marimo-lens.event"] = EVENT_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    type: Literal["attention.reveal"] = "attention.reveal"
    payload: Trail


class TrailStopPayload(TransportModel):
    trail_id: Identifier


class AttentionTrailStopEvent(TransportModel):
    protocol: Literal["marimo-lens.event"] = EVENT_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    type: Literal["attention.trail.stop"] = "attention.trail.stop"
    payload: TrailStopPayload


class AttentionActivityStartPayload(TransportModel):
    activity_id: Identifier
    address: AttentionAddress
    duration_ms: AttentionDuration | None = None
    label: AttentionLabel | None = None
    message: AttentionText | None = None


class AttentionActivityStartEvent(TransportModel):
    protocol: Literal["marimo-lens.event"] = EVENT_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    type: Literal["attention.activity.start"] = "attention.activity.start"
    payload: AttentionActivityStartPayload


class AttentionActivityStopPayload(TransportModel):
    activity_id: Identifier


class AttentionActivityStopEvent(TransportModel):
    protocol: Literal["marimo-lens.event"] = EVENT_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    type: Literal["attention.activity.stop"] = "attention.activity.stop"
    payload: AttentionActivityStopPayload


AttentionEvent: TypeAlias = (
    AttentionActivityStartEvent
    | AttentionActivityStopEvent
    | AttentionRevealEvent
    | AttentionTrailStopEvent
)


class ResolvedSelection(TransportModel):
    selection_id: Identifier
    label: SelectionLabel
    resolution_revision: Revision


class SelectionResolvedPayload(TransportModel):
    selections: Annotated[
        tuple[ResolvedSelection, ...],
        Field(min_length=1, max_length=MAX_SELECTIONS),
    ]
    summary: AttentionText | None = None

    @model_validator(mode="after")
    def unique_selections(self) -> Self:
        selection_ids = tuple(selection.selection_id for selection in self.selections)
        if len(selection_ids) != len(set(selection_ids)):
            raise PydanticCustomError(
                "invalid_selection",
                "Resolved selections must be unique",
            )
        return self


class SelectionResolvedEvent(TransportModel):
    protocol: Literal["marimo-lens.event"] = EVENT_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    type: Literal["selection.resolved"] = "selection.resolved"
    revision: Revision
    payload: SelectionResolvedPayload


class SuccessResponse(TransportModel):
    protocol: Literal["marimo-lens.response"] = RESPONSE_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    request_id: RequestId
    ok: Literal[True] = True
    revision: Revision
    payload: dict[str, Any]


class FailureResponse(TransportModel):
    protocol: Literal["marimo-lens.response"] = RESPONSE_PROTOCOL
    version: ProtocolVersion = PROTOCOL_VERSION
    request_id: str
    ok: Literal[False] = False
    revision: Revision
    payload: dict[str, Any]
    error: ErrorDetail


class SnapshotResponsePayload(TransportModel):
    selection_id: Identifier
    snapshot: AvailableSnapshot | OutdatedSnapshot


COMMAND_ADAPTER = TypeAdapter(ClientCommand)
CAPTURE_RESPONSE_ADAPTER = TypeAdapter(OutputCaptureResponse)
CAPTURE_BROWSER_EVENT_ADAPTER = TypeAdapter(CaptureBrowserMessage)
OUTPUT_CAPTURE_IMAGE_ADAPTER = TypeAdapter(OutputCaptureImage)
SELECTION_ADAPTER = TypeAdapter(Selection)
SELECTION_INPUT_ADAPTER = TypeAdapter(SelectionInput)
ADDRESSED_SELECTION_ADAPTER = TypeAdapter(AddressedSelection)
SELECTION_ID_ADAPTER = TypeAdapter(Identifier)
REQUEST_ID_ADAPTER = TypeAdapter(RequestId)
CELL_ID_ADAPTER = TypeAdapter(CellId)
DOM_SELECTOR_ADAPTER = TypeAdapter(DomSelectorText)
REVISION_ADAPTER = TypeAdapter(Revision)
POSITIVE_SAFE_INTEGER_ADAPTER = TypeAdapter(PositiveSafeInteger)
NONNEGATIVE_SAFE_INTEGER_ADAPTER = TypeAdapter(NonNegativeSafeInteger)
SELECTION_LABEL_ADAPTER = TypeAdapter(SelectionLabel)
OPTIONAL_ATTENTION_TEXT_ADAPTER = TypeAdapter(OptionalAttentionText)
OPTIONAL_REVEAL_TEXT_ADAPTER = TypeAdapter(OptionalRevealText)
OPTIONAL_ATTENTION_LABEL_ADAPTER = TypeAdapter(OptionalAttentionLabel)
ATTENTION_DURATION_ADAPTER = TypeAdapter(AttentionDuration)


def dump_model(model: BaseModel) -> dict[str, Any]:
    """Return one browser-shaped mapping from a validated model."""

    return model.model_dump(
        by_alias=True,
        exclude_none=True,
        mode="json",
    )
