"""Public context snapshots returned by :class:`marimo_lens.Lens`."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, cast


@dataclass(frozen=True, slots=True)
class SelectionImage:
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


@dataclass(frozen=True, slots=True, repr=False)
class LensContext:
    """Detached live references, standalone text, and optional images.

    ``references`` contains compact cell-backed selections for a live notebook
    consumer. ``text`` contains bounded source and runtime context for a
    text-only handoff. ``images`` contains successful PNG captures in selection
    order and may be empty.
    """

    references: Mapping[str, object]
    text: str
    images: tuple[SelectionImage, ...]

    @property
    def current(self) -> Mapping[str, object] | None:
        """Return the current selection reference, if one exists."""

        current_id = self.references.get("currentSelectionId")
        selections = self.references.get("selections")
        if not isinstance(current_id, str) or not isinstance(selections, Sequence):
            return None
        for selection in selections:
            if isinstance(selection, Mapping) and selection.get("id") == current_id:
                return cast(Mapping[str, object], selection)
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
        return (
            "LensContext("
            f"selections={selection_count}, "
            f"text_chars={len(self.text)}, "
            f"images={len(self.images)}, "
            f"image_bytes={image_bytes}"
            ")"
        )


__all__ = ["LensContext", "SelectionImage"]
