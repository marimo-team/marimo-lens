"""Commands, responses, and events of the Lens browser protocol."""

from __future__ import annotations

from typing import Annotated, Any, Literal, TypeAlias

from pydantic import (
    Field,
    TypeAdapter,
    model_validator,
)
from pydantic_core import PydanticCustomError
from typing_extensions import Self

from .._core.bounds import (
    MAX_SELECTIONS,
    MAX_TRAIL_STEPS,
    AttentionDuration,
    AttentionLabel,
    AttentionText,
    CellId,
    ErrorCode,
    Identifier,
    NonEmptyErrorText,
    RequestId,
    RevealText,
    Revision,
    SelectionLabel,
)
from .._schema.model import TransportModel
from .._schema.selection import (
    ImageAction,
    OutputCaptureImage,
    SelectionInput,
)

COMMAND_PROTOCOL = "marimo-lens.command"

RESPONSE_PROTOCOL = "marimo-lens.response"

EVENT_PROTOCOL = "marimo-lens.event"

PROTOCOL_VERSION = 7

ProtocolVersion: TypeAlias = Annotated[
    int,
    Field(
        strict=True,
        ge=PROTOCOL_VERSION,
        le=PROTOCOL_VERSION,
    ),
]


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


COMMAND_ADAPTER = TypeAdapter(ClientCommand)

CAPTURE_RESPONSE_ADAPTER = TypeAdapter(OutputCaptureResponse)

CAPTURE_BROWSER_EVENT_ADAPTER = TypeAdapter(CaptureBrowserMessage)
