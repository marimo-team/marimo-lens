"""Public context snapshots returned by :class:`marimo_lens.Lens`."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from types import MappingProxyType
from typing import TypeGuard, cast

from pydantic import ValidationError
from typing_extensions import Self

from .._core.bounds import CELL_ID_ADAPTER, REVISION_ADAPTER
from .._core.errors import LensError
from .._core.types import (
    CellReference,
    ChatRequestReference,
    LensReferences,
    RecordedRequest,
    RequestReference,
    SelectionReference,
    cell_address,
)


class LensContext:
    """Detached brief, references, history, standalone text, and images.

    ``Lens.context()``, ``MountedLens.context()``, and ``notebook_context()``
    create it from one selection-state revision, one runtime snapshot, and
    one read of the record when the Lens keeps one. ``brief`` describes the
    open request
    identified by ``request``.
    ``references`` contains compact notebook or DOM targets and their
    producing cells. ``history()`` joins recorded requests with the notebook.
    ``text`` contains bounded source and runtime context for a text-only
    handoff. ``images`` maps selection IDs to captured PNG bytes.
    """

    __slots__ = (
        "_brief",
        "_brief_factory",
        "_history",
        "_images",
        "_lock",
        "_references",
        "_request",
        "_text",
        "_text_factory",
    )

    _request: RequestReference | None
    _references: LensReferences
    _text: str | None
    _text_factory: Callable[[], str] | None
    _brief: str | None
    _brief_factory: Callable[[], str] | None
    _history: Callable[[Sequence[str] | None], list[RecordedRequest]] | None
    _images: Mapping[str, bytes]
    _lock: threading.RLock

    def __init__(self) -> None:
        raise TypeError(
            "Read a LensContext with Lens.context(), MountedLens.context(), or "
            "marimo_lens.notebook_context()."
        )

    @classmethod
    def _create(
        cls,
        *,
        references: Mapping[str, object],
        request: RequestReference | None,
        text: Callable[[], str],
        brief: Callable[[], str],
        history: Callable[[Sequence[str] | None], list[RecordedRequest]] | None,
        images: Mapping[str, bytes],
    ) -> Self:
        self = object.__new__(cls)
        self._request = deepcopy(request)
        self._references = cast(LensReferences, deepcopy(references))
        self._text = None
        self._text_factory = text
        self._brief = None
        self._brief_factory = brief
        self._history = history
        self._images = MappingProxyType(dict(images))
        self._lock = threading.RLock()
        return self

    @property
    def request(self) -> RequestReference | None:
        """Return the open request described by the brief, or None.

        The newest chat request takes precedence when it opened after the
        current selection. Otherwise the current selection is the request.
        The returned dictionary is a copy captured by this context. Keep its
        ID across calls so a later request cannot replace the work in progress.
        """

        return deepcopy(self._request)

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
                assert factory is not None
                self._text = factory()
                self._text_factory = None
            return self._text

    def history(
        self,
        target: str
        | CellReference
        | Sequence[str | CellReference]
        | SelectionReference
        | RequestReference
        | ChatRequestReference
        | None = None,
    ) -> list[RecordedRequest]:
        """Return recorded requests in time order, each change with its status.

        With no target, return every recorded request, at most the newest 256.
        With cells, return the requests whose changed or traced cells are now
        those cells or their upstream closure, or whose lost code now lives
        there. Name cells by ID or cell reference, alone or in a sequence, or
        pass a reference that lists cells, such as ``context.request`` or a
        SelectionReference. The rows are JSON-safe, so
        ``pl.DataFrame(context.history())`` works.

        Check ``mounted.record`` or ``references["notebook"]["record"]`` before
        calling it. A Lens built without a record has no history to return.

        Raises:
            LensError: ``record_off``: the Lens keeps no record. Construct it
                as ``Lens(record=True)`` to keep resolved requests.
            TypeError: The target names no cells in one of those forms.
            ValueError: A cell ID is empty or too long, or the sequence is
                empty.
        """

        if self._history is None:
            raise LensError(
                "record_off",
                "This Lens keeps no record. Construct it as Lens(record=True) "
                "to keep resolved requests.",
                revision=self.revision,
            )
        return deepcopy(self._history(_target_cells(target)))

    @property
    def brief(self) -> str:
        """Return the first read for the current request, at most 4,000 characters.

        The current request is the newest open chat request when it opened
        after the current selection, or else the current selection. The brief
        gives its note, the part the analyst pointed
        at, the producing cells and their state, earlier requests on those
        cells and upstream with whether their changes still hold when the
        Lens keeps a record, the other open requests, and the Lens calls that
        fetch more. It holds no cell code, values, or images.
        """

        with self._lock:
            if self._brief is None:
                factory = self._brief_factory
                assert factory is not None
                self._brief = factory()
                self._brief_factory = None
            return self._brief

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


_TARGET = (
    "target must be a cell ID, a cell reference, a sequence of either, or a "
    "reference that lists cells, such as context.request."
)


def _target_cells(target: object) -> tuple[str, ...] | None:
    if target is None:
        return None
    if isinstance(target, Mapping) and _listed(target.get("cells")):
        # A selection, request, or chat request reference lists its cells.
        items: Sequence[object] = target["cells"]
    elif isinstance(target, str | Mapping):
        items = (target,)
    elif _listed(target):
        items = target
        if not items:
            raise ValueError("target must name at least one cell.")
    else:
        raise TypeError(_TARGET)
    return tuple(dict.fromkeys(_cell_id(cell_address(item)) for item in items))


def _listed(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, str)


def _cell_id(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError(_TARGET)
    try:
        return CELL_ID_ADAPTER.validate_python(value)
    except ValidationError:
        raise ValueError(
            "target must be a nonblank cell ID of at most 128 UTF-16 code units."
        ) from None
