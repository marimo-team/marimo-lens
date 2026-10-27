"""Selections and their targets as Python and browsers exchange them."""

from __future__ import annotations

from functools import partial
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    AfterValidator,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_serializer,
    model_validator,
)
from pydantic_core import PydanticCustomError
from typing_extensions import Self

from .._core.bounds import (
    AttentionText,
    CellId,
    DomContentText,
    DomFieldText,
    DomSelectorText,
    ErrorText,
    Identifier,
    NormalizedNumber,
    NoteText,
    OutputImageId,
    PositiveNormalizedNumber,
    PositiveSafeInteger,
    SelectionImageId,
    SelectionLabel,
    Sha256,
    TimestampText,
    UnicodeText,
    bounded_utf16,
    nonblank,
)
from .model import TransportModel


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
    tag: Annotated[DomFieldText, AfterValidator(nonblank)]
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
            AfterValidator(nonblank),
            AfterValidator(partial(bounded_utf16, maximum=4_096)),
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

ImageAction: TypeAlias = Literal["preserve", "replace", "clear"]


class RenderSource(TransportModel):
    model_config = ConfigDict(extra="forbid")

    path: DomSelectorText
    line: PositiveSafeInteger | None = None
    column: PositiveSafeInteger | None = None
    symbol: (
        Annotated[
            UnicodeText,
            AfterValidator(nonblank),
            AfterValidator(partial(bounded_utf16, maximum=256)),
        ]
        | None
    ) = None


Seconds: TypeAlias = Annotated[
    float,
    Field(strict=True, ge=0, allow_inf_nan=False),
]


class TargetMedia(TransportModel):
    model_config = ConfigDict(extra="forbid")

    path: DomSelectorText
    page: PositiveSafeInteger | None = None
    start: Seconds | None = None
    end: Seconds | None = None

    @model_validator(mode="after")
    def ends_after_start(self) -> Self:
        if self.start is not None and self.end is not None and self.end <= self.start:
            raise PydanticCustomError(
                "invalid_selection", "Media end must come after its start"
            )
        return self


class TargetInfo(TransportModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[
        UnicodeText,
        AfterValidator(nonblank),
        AfterValidator(partial(bounded_utf16, maximum=256)),
    ]
    detail: (
        Annotated[
            UnicodeText,
            AfterValidator(nonblank),
            AfterValidator(partial(bounded_utf16, maximum=512)),
        ]
        | None
    ) = None
    render_source: RenderSource | None = None
    media: TargetMedia | None = None


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
    resolved_at: TimestampText
    summary: AttentionText | None = None


class Selection(SelectionInput):
    previous_resolution: PreviousResolution | None = None


class OutputCaptureImage(PngMetadata):
    status: Literal["available"]
    id: OutputImageId


OUTPUT_CAPTURE_IMAGE_ADAPTER = TypeAdapter(OutputCaptureImage)

SELECTION_ADAPTER = TypeAdapter(Selection)
