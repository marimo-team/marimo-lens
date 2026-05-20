"""Inspect MIME-bearing marimo and rich-display outputs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .._serialization import safe_value
from ._capabilities import capabilities, selection_policy
from ._core import LensEntity

_IMAGE_MIMES = {
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/tiff",
}
_MEDIA_MIMES = _IMAGE_MIMES | {"audio/mpeg", "audio/wav", "video/mp4", "video/mpeg"}
_DOCUMENT_MIMES = {"application/pdf", "text/html", "text/latex", "text/markdown"}
_DATA_MIMES = {
    "application/geo+json",
    "application/json",
    "text/csv",
    "text/tab-separated-values",
}
_DIAGNOSTIC_MIMES = {
    "application/vnd.marimo+error",
    "application/vnd.marimo+traceback",
    "text/x-traceback",
}


class OutputInspector:
    """Classify MIME and rich-display objects into coarse output families."""

    id = "output"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        bundle = _mime_bundle(entity.value)
        if not bundle:
            return None
        mime = _preferred_mime(bundle)
        if mime is None:
            return None
        metadata = _output_metadata(mime, bundle[mime])
        if metadata is None:
            return None
        return _target(entity.name, metadata)


def _target(name: str, metadata: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(metadata["kind"])
    family = str(metadata["family"])
    surface = str(metadata["surface"])
    payload_key = "media" if kind == "media" else kind
    return {
        "kind": kind,
        "family": family,
        payload_key: dict(metadata["context"]),
        "shape": None,
        "columns": [],
        "capabilities": capabilities(
            media=kind == "media",
            document=kind == "document",
            data=kind == "data",
            diagnostic=kind == "diagnostic",
        ),
        "selectionPolicy": selection_policy(surface, context=metadata["context"]),
        "summary": f"{name}: {family}",
    }


def _output_metadata(mime: str, payload: Any) -> dict[str, Any] | None:
    if mime == "text/html":
        html_family = _html_family(payload)
        if html_family is not None:
            kind, label, surface = html_family
            return {
                "kind": kind,
                "family": label,
                "surface": surface,
                "context": {
                    "family": label,
                    "mime": mime,
                    "renderer": "html",
                    "payload": safe_value(payload),
                },
            }
    family = _mime_family(mime)
    if family is None:
        return None
    kind, label, surface = family
    return {
        "kind": kind,
        "family": label,
        "surface": surface,
        "context": {
            "family": label,
            "mime": mime,
            "renderer": "mime",
            "payload": safe_value(payload),
        },
    }


def _mime_family(mime: str) -> tuple[str, str, str] | None:
    if mime in _DIAGNOSTIC_MIMES:
        return ("diagnostic", "diagnostic", "selector")
    if mime in _DATA_MIMES:
        return ("data", "data", "selector")
    if mime in _DOCUMENT_MIMES:
        return ("document", "document", "document")
    if mime in _MEDIA_MIMES:
        if mime.startswith("audio/"):
            return ("media", "audio", "media")
        if mime.startswith("video/"):
            return ("media", "video", "media")
        return ("media", "image", "media")
    return None


def _html_family(payload: Any) -> tuple[str, str, str] | None:
    text = str(payload).lower()
    if any(marker in text for marker in ("<img", "<picture")):
        return ("media", "image", "media")
    if "<audio" in text:
        return ("media", "audio", "media")
    if "<video" in text:
        return ("media", "video", "media")
    if any(marker in text for marker in ("<embed", "<iframe", "<object")):
        return ("document", "document", "document")
    return None


def _preferred_mime(bundle: Mapping[str, Any]) -> str | None:
    for group in (_DIAGNOSTIC_MIMES, _DATA_MIMES, _DOCUMENT_MIMES, _MEDIA_MIMES):
        for mime in group:
            if mime in bundle:
                return mime
    return None


def _mime_bundle(value: Any) -> dict[str, Any]:
    for method_name in ("_mime_", "_repr_mimebundle_"):
        method = getattr(value, method_name, None)
        if callable(method):
            try:
                bundle = _normalize_mime_result(method())
            except Exception:
                bundle = {}
            if bundle:
                return bundle

    repr_methods = {
        "_repr_html_": "text/html",
        "_repr_jpeg_": "image/jpeg",
        "_repr_json_": "application/json",
        "_repr_latex_": "text/latex",
        "_repr_markdown_": "text/markdown",
        "_repr_pdf_": "application/pdf",
        "_repr_png_": "image/png",
        "_repr_svg_": "image/svg+xml",
    }
    bundle: dict[str, Any] = {}
    for method_name, mime in repr_methods.items():
        method = getattr(value, method_name, None)
        if not callable(method):
            continue
        try:
            bundle[mime] = method()
        except Exception:
            continue
    return bundle


def _normalize_mime_result(value: Any) -> dict[str, Any]:
    if isinstance(value, tuple) and len(value) >= 2 and isinstance(value[0], str):
        return {value[0]: value[1]}
    if isinstance(value, tuple) and value and isinstance(value[0], Mapping):
        return {
            str(key): item for key, item in value[0].items() if isinstance(key, str)
        }
    if isinstance(value, Mapping):
        return {str(key): item for key, item in value.items() if isinstance(key, str)}
    return {}
