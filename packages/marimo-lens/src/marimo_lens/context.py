"""Public context snapshots returned by :class:`marimo_lens.Lens`."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from types import MappingProxyType
from typing import Literal, TypeAlias, TypedDict, cast

from pydantic import ValidationError
from typing_extensions import NotRequired, Self

from ._protocol_models import REVISION_ADAPTER


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


class TargetDescription(TypedDict):
    """Bounded presentation captured when the selection was created."""

    label: str
    detail: NotRequired[str]
    renderSource: NotRequired[RenderSourceReference]


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


class LensContext:
    """Detached live references, standalone text, and optional images.

    ``references`` contains compact notebook or DOM targets and their
    producing cells. ``text`` contains bounded source and runtime context for a
    text-only handoff. ``images`` maps selection IDs to captured PNG bytes.
    """

    __slots__ = ("_images", "_lock", "_references", "_text", "_text_factory")

    _references: LensReferences
    _text: str | None
    _text_factory: Callable[[], str] | None
    _images: Mapping[str, bytes]
    _lock: threading.RLock

    def __init__(
        self,
        references: Mapping[str, object],
        text: str,
        images: Mapping[str, bytes],
    ) -> None:
        self._references = cast(LensReferences, deepcopy(references))
        self._text = text
        self._text_factory = None
        self._images = MappingProxyType(dict(images))
        self._lock = threading.RLock()

    @classmethod
    def _create_lazy(
        cls,
        *,
        references: LensReferences,
        text_factory: Callable[[], str],
        images: Mapping[str, bytes],
    ) -> Self:
        self = object.__new__(cls)
        self._references = deepcopy(references)
        self._text = None
        self._text_factory = text_factory
        self._images = MappingProxyType(dict(images))
        self._lock = threading.RLock()
        return self

    @property
    def references(self) -> LensReferences:
        """Return compact target and producing-cell references."""

        return self._references

    @property
    def text(self) -> str:
        """Return cached standalone text context."""

        with self._lock:
            if self._text is None:
                factory = self._text_factory
                if factory is None:
                    raise RuntimeError("Lens context text has no renderer.")
                self._text = factory()
                self._text_factory = None
            return self._text

    @property
    def images(self) -> Mapping[str, bytes]:
        """Return captured PNG bytes indexed by selection ID."""

        return self._images

    @property
    def revision(self) -> int:
        """Return the Lens selection revision captured by this context."""

        try:
            return REVISION_ADAPTER.validate_python(self.references.get("revision"))
        except ValidationError:
            raise ValueError(
                "Lens context references do not contain a valid revision."
            ) from None

    @property
    def current(self) -> SelectionReference | None:
        """Return the current selection reference, if one exists."""

        current_id = self.references.get("currentSelectionId")
        selections = self.references.get("selections")
        if not isinstance(current_id, str) or not isinstance(selections, Sequence):
            return None
        for selection in selections:
            if isinstance(selection, Mapping) and selection.get("id") == current_id:
                return selection
        return None

    def __repr__(self) -> str:
        selections = self.references.get("selections")
        selection_count = (
            len(selections)
            if isinstance(selections, Sequence)
            and not isinstance(selections, (str, bytes, bytearray))
            else 0
        )
        image_bytes = sum(len(data) for data in self.images.values())
        text_chars: int | str = len(self._text) if self._text is not None else "pending"
        return (
            "LensContext("
            f"selections={selection_count}, "
            f"text_chars={text_chars}, "
            f"images={len(self.images)}, "
            f"image_bytes={image_bytes}"
            ")"
        )


__all__ = [
    "CellReference",
    "LensContext",
    "LensReferences",
    "NotebookReference",
    "SelectionReference",
    "SelectionTargetReference",
]
