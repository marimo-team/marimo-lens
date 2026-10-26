"""Typed dictionaries and handles that the public Lens API returns."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, NewType, TypeAlias, TypedDict

from typing_extensions import NotRequired


class NotebookReference(TypedDict):
    """Bounded notebook metadata captured by one :class:`LensContext`."""

    path: str
    available: bool
    reason: NotRequired[str]


class CellReference(TypedDict):
    """One producing notebook cell linked to a Lens target."""

    id: str
    status: Literal["available", "missing", "unavailable"]


class _NotebookTargetReference(TypedDict):
    kind: Literal["notebook"]
    cellIds: list[str]
    documentId: str
    documentPath: str


class NotebookSourceReference(TypedDict):
    """A resolved notebook cell and optional symbolic value selector."""

    cellId: str
    selector: str | None


class _DomTargetReference(TypedDict):
    kind: Literal["dom"]
    cellIds: list[str]
    sources: list[NotebookSourceReference]
    documentId: str
    documentPath: str
    domSelector: str


SelectionTargetReference: TypeAlias = _NotebookTargetReference | _DomTargetReference


class RenderSourceReference(TypedDict):
    """Client-supplied rendering location, separate from notebook provenance."""

    path: str
    line: NotRequired[int]
    column: NotRequired[int]
    symbol: NotRequired[str]


class TargetMediaReference(TypedDict):
    """The file a target shows part of, with its page or time span in seconds."""

    path: str
    page: NotRequired[int]
    start: NotRequired[float]
    end: NotRequired[float]


class TargetDescription(TypedDict):
    """Bounded presentation captured when the selection was created."""

    label: str
    detail: NotRequired[str]
    renderSource: NotRequired[RenderSourceReference]
    media: NotRequired[TargetMediaReference]


class SelectionReference(TypedDict):
    """One JSON-safe reference to an open Lens selection."""

    id: str
    label: str
    note: str
    target: SelectionTargetReference
    cells: list[CellReference]
    anchor: Mapping[str, object]
    snapshot: Mapping[str, object]
    description: NotRequired[TargetDescription]
    domHint: NotRequired[Mapping[str, object]]
    previousResolution: NotRequired[Mapping[str, object]]


class LensReferences(TypedDict):
    """JSON-safe references captured by one :class:`LensContext`."""

    revision: int
    generatedAt: str
    notebook: NotebookReference
    currentSelectionId: str | None
    selections: list[SelectionReference]


ActivityHandle = NewType("ActivityHandle", str)


class RevealStep(TypedDict):
    """A cell or selection and the explanation shown while visiting it."""

    target: str | SelectionReference
    label: NotRequired[str]
    message: NotRequired[str]
