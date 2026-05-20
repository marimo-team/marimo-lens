"""Inspector for coarse media outputs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ._capabilities import capabilities, selection_policy
from ._core import LensEntity

_MEDIA_HTML_MARKERS = (
    "<audio",
    "<img",
    "<picture",
    "<video",
)


class MediaInspector:
    id = "media"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        media = _media_metadata(entity.value)
        if media is None:
            return None
        return {
            "kind": "media",
            "family": "media",
            "media": media,
            "shape": None,
            "columns": [],
            "capabilities": capabilities(media=True),
            "selectionPolicy": selection_policy("media", context=media),
            "summary": f"{entity.name}: {media['family']} media",
        }


def _media_metadata(value: Any) -> dict[str, str] | None:
    html_family = _media_html_family(value)
    if html_family:
        return {"family": html_family, "renderer": "html"}
    if callable(getattr(value, "_repr_png_", None)):
        return {"family": "image", "mime": "image/png", "renderer": "repr"}
    if callable(getattr(value, "_repr_jpeg_", None)):
        return {"family": "image", "mime": "image/jpeg", "renderer": "repr"}
    return None


def _media_html_family(value: Any) -> str | None:
    module = type(value).__module__.lower()
    qualname = type(value).__qualname__.lower()
    if "marimo" not in module or qualname != "html":
        return None
    text = str(getattr(value, "text", "") or getattr(value, "_text", "") or "")
    lowered = text.lower()
    for marker in _MEDIA_HTML_MARKERS:
        if marker not in lowered:
            continue
        if marker in {"<audio", "<video"}:
            return marker.removeprefix("<")
        return "image"
    return None
