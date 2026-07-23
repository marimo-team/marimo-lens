"""Public context snapshots returned by :class:`marimo_lens.Lens`."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
import threading
from typing import Any, Literal, Self, cast

from marimo import Html
from pydantic import ValidationError

from ._protocol_models import REVISION_ADAPTER


class _RenderablePng:
    """Render immutable PNG bytes through marimo's native image output."""

    __slots__ = ()

    @property
    def data(self) -> bytes:
        raise NotImplementedError

    def render(
        self,
        *,
        alt: str | None = None,
        width: int | str | None = None,
        height: int | str | None = None,
    ) -> Html:
        """Return a marimo image for these PNG bytes."""

        import marimo as mo

        return mo.image(self.data, alt=alt, width=width, height=height)

    def _display_(self) -> Html:
        """Render the image when it is the value of a marimo cell."""

        return self.render()


@dataclass(frozen=True, slots=True)
class SelectionImage(_RenderablePng):
    """One successfully captured PNG associated with a selection."""

    id: str
    selection_id: str
    media_type: Literal["image/png"]
    data: bytes = field(repr=False)
    width: int
    height: int
    sha256: str
    captured_at: str
    outdated: bool


class LensContext:
    """Detached live references, standalone text, and optional images.

    ``references`` contains compact cell-backed selections for a live notebook
    consumer. ``text`` contains bounded source and runtime context for a
    text-only handoff. ``images`` contains successful PNG captures in selection
    order and may be empty.
    """

    __slots__ = ("_images", "_lock", "_references", "_text", "_text_factory")

    _references: Mapping[str, object]
    _text: str | None
    _text_factory: Callable[[], str] | None
    _images: tuple[SelectionImage, ...]
    _lock: threading.RLock

    def __init__(
        self,
        references: Mapping[str, object],
        text: str,
        images: tuple[SelectionImage, ...],
    ) -> None:
        self._references = references
        self._text = text
        self._text_factory: Callable[[], str] | None = None
        self._images = images
        self._lock = threading.RLock()

    @classmethod
    def _create_lazy(
        cls,
        *,
        references: Mapping[str, object],
        text_factory: Callable[[], str],
        images: tuple[SelectionImage, ...],
    ) -> Self:
        self = object.__new__(cls)
        self._references = references
        self._text = None
        self._text_factory = text_factory
        self._images = images
        self._lock = threading.RLock()
        return self

    @property
    def references(self) -> Mapping[str, object]:
        """Return compact cell-backed selection references."""

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
    def images(self) -> tuple[SelectionImage, ...]:
        """Return successful selection captures in selection order."""

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
    def current(self) -> Mapping[str, Any] | None:
        """Return the current selection reference, if one exists."""

        current_id = self.references.get("currentSelectionId")
        selections = self.references.get("selections")
        if not isinstance(current_id, str) or not isinstance(selections, Sequence):
            return None
        for selection in selections:
            if isinstance(selection, Mapping) and selection.get("id") == current_id:
                return cast(Mapping[str, Any], selection)
        return None

    def __repr__(self) -> str:
        selections = self.references.get("selections")
        selection_count = (
            len(selections)
            if isinstance(selections, Sequence)
            and not isinstance(selections, (str, bytes, bytearray))
            else 0
        )
        image_bytes = sum(len(image.data) for image in self.images)
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
    "LensContext",
    "SelectionImage",
]
