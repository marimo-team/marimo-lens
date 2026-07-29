"""Agent adapter for mounted marimo Lens widgets.

Example:
    import marimo_lens.agent as lens_agent
    import marimo._code_mode as cm

    async with cm.get_context() as ctx:
        mounted = lens_agent.discover(ctx)
        scans = [lens.scan() for lens in mounted]

``discover(ctx, identity=...)`` reconnects to the exact Lens from an earlier
scan. An empty result means that instance is no longer mounted.

Use :meth:`MountedLens.context` for standalone text, selection context, and
captured selection images. Use :meth:`MountedLens.selection_image` when the
pixels captured with one selection are required.

Full-cell images use a two-call mailbox. Start with
:meth:`MountedLens.start_cell_image`, then call
:meth:`MountedLens.read_cell_image` until it returns a terminal result. Pipe
``result.transfer()`` or ``image.transfer()`` directly to the marimo-lens
skill's ``materialize-image.sh`` script so PNG bytes stay out of the agent's
text context.

Call :meth:`MountedLens.activity` after grounding and before a notebook
mutation. After a fresh runtime check, call :meth:`MountedLens.resolve`, then
:meth:`MountedLens.reveal`.
"""

from __future__ import annotations

import base64
import json
import re
import secrets
import threading
import weakref
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from ._images import OutputImage
from ._output_capture import OutputCaptureResult
from .context import LensContext, SelectionImage
from .errors import LensError
from .widget import Lens

_IMAGE_TRANSFER_PREFIX = "__MARIMO_LENS_IMAGE__"
_MAX_ALIASES = 4
_MAX_CURRENT_NOTE = 1_000
_MAX_DOM_TEXT = 240
_MAX_GRAPH_NAME = 80
_MAX_GRAPH_NAMES = 16
_MAX_IDENTIFIER = 128
_MAX_INDEXED_SELECTIONS = 16
_MAX_NOTE_PREVIEW = 80
_MAX_NOTEBOOK_PATH = 900
_MAX_REASON = 240
_MANGLED_BINDING = re.compile(r"^_cell_(?:[^\W_][\w-]*?)(_.*)$")

_IDENTITIES: weakref.WeakKeyDictionary[Lens, str] = weakref.WeakKeyDictionary()
_IDENTITIES_LOCK = threading.RLock()


@dataclass(frozen=True, slots=True)
class AgentImage:
    """One validated Lens PNG ready for a client-side transfer."""

    source: Literal["selection", "cell"]
    media_type: Literal["image/png"]
    data: bytes = field(repr=False)
    width: int
    height: int
    sha256: str
    captured_at: str
    cell_id: str
    selection_id: str | None = None
    outdated: bool | None = None

    def transfer(self) -> str:
        """Return one marked transfer record for ``materialize-image.sh``."""

        return _encode_transfer(
            status="available",
            source=self.source,
            cell_id=self.cell_id,
            selection_id=self.selection_id,
            outdated=self.outdated,
            image=self,
        )


@dataclass(frozen=True, slots=True)
class CellImageResult:
    """One read from a mounted Lens full-cell image request."""

    request_id: str
    cell_id: str
    selection_ids: tuple[str, ...]
    status: Literal["pending", "available", "failed"]
    image: AgentImage | None = None
    error_code: str | None = None
    error: str | None = None

    def transfer(self) -> str:
        """Return one marked transfer record for ``materialize-image.sh``."""

        return _encode_transfer(
            status=self.status,
            source="cell",
            cell_id=self.cell_id,
            request_id=self.request_id,
            selection_ids=self.selection_ids,
            error_code=self.error_code,
            error=self.error,
            image=self.image,
        )


@dataclass(frozen=True, slots=True)
class MountedLens:
    """One mounted Lens discovered in a live marimo code-mode context."""

    identity: str
    names: tuple[str, ...]
    _lens: Lens = field(repr=False)
    _context: object = field(repr=False)

    def scan(self) -> dict[str, object]:
        """Return bounded metadata for the current Lens attention."""

        context = self._lens.context()
        references = context.references
        selections = _selection_rows(references)
        current_id = references.get("currentSelectionId")
        current = next(
            (
                selection
                for selection in selections
                if selection.get("id") == current_id
            ),
            None,
        )
        ordered = ([] if current is None else [current]) + [
            selection for selection in selections if selection.get("id") != current_id
        ]
        indexed = ordered[:_MAX_INDEXED_SELECTIONS]
        return {
            "identity": self.identity,
            "revision": context.revision,
            "lens": {
                "variable": _identifier(self.names[0]),
                "aliases": [
                    _identifier(name) for name in self.names[1 : _MAX_ALIASES + 1]
                ],
                "omittedAliasCount": max(0, len(self.names) - _MAX_ALIASES - 1),
            },
            "notebook": _notebook_summary(references.get("notebook")),
            "selectionCount": len(selections),
            "omittedSelectionCount": max(0, len(selections) - len(indexed)),
            "current": _current_selection(current),
            "selections": [
                _selection_index(selection, current_id) for selection in indexed
            ],
            "currentCell": _cell_summary(
                self._context,
                None if current is None else current.get("outputCellId"),
            ),
        }

    def context(self, *, expected_revision: int) -> LensContext:
        """Return full detached context after checking the scan revision."""

        context = self._lens.context()
        _require_revision(context, expected_revision)
        return context

    def selection_image(
        self,
        selection_id: str,
        *,
        expected_revision: int,
    ) -> AgentImage | None:
        """Return one captured selection PNG, or ``None`` when unavailable."""

        context = self.context(expected_revision=expected_revision)
        selection = _find_selection(context, selection_id)
        image = next(
            (
                candidate
                for candidate in context.images
                if candidate.selection_id == selection_id
            ),
            None,
        )
        if image is None:
            return None
        return _selection_agent_image(image, selection)

    def start_cell_image(self, cell_id: str, *, expected_revision: int) -> str:
        """Start a full-cell PNG request and return its opaque request ID."""

        return self._lens._start_output_capture(
            cell_id,
            expected_revision=expected_revision,
        )

    def read_cell_image(self, request_id: str) -> CellImageResult:
        """Read pending state or consume one terminal full-cell PNG result."""

        return _cell_image_result(self._lens._read_output_capture(request_id))

    def activity(
        self,
        cell_id: str,
        *,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Show the cell where the agent is applying the grounded request."""

        self._lens.activity(cell_id, label=label, message=message)

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move verified selections to History and return the new revision."""

        return self._lens.resolve(
            selection_ids,
            expected_revision=expected_revision,
            summary=summary,
        )

    def reveal(
        self,
        cell_id: str,
        *,
        message: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Bring one verified or explanatory cell into view."""

        self._lens.reveal(
            cell_id,
            message=message,
            duration_ms=duration_ms,
        )


def discover(
    context: object,
    *,
    identity: str | None = None,
) -> tuple[MountedLens, ...]:
    """Return mounted Lens handles from a live marimo code-mode context.

    Pass an ``identity`` from :meth:`MountedLens.scan` to reconnect to the same
    Lens in a later kernel call. The result is empty if that Lens changed or
    became unavailable.
    """

    namespace = getattr(context, "globals", None)
    if not isinstance(namespace, Mapping):
        raise TypeError("context must expose a globals mapping")
    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    candidates: dict[int, tuple[Lens, set[str]]] = {}
    for name, value in namespace.items():
        lens = _as_lens(value)
        if lens is None:
            continue
        candidate = candidates.setdefault(id(lens), (lens, set()))
        candidate[1].add(_binding_name(name))

    mounted = tuple(
        MountedLens(
            identity=_identity(lens),
            names=_ordered_names(names),
            _lens=lens,
            _context=context,
        )
        for lens, names in candidates.values()
    )
    if identity is None:
        return mounted
    return tuple(lens for lens in mounted if lens.identity == identity)


def _as_lens(value: object) -> Lens | None:
    if isinstance(value, Lens):
        lens = value
    elif type(value).__module__.startswith("marimo."):
        lens = getattr(value, "widget", None)
        if not isinstance(lens, Lens):
            return None
    else:
        return None
    if getattr(lens, "_lens_closed", False) or getattr(lens, "comm", None) is None:
        return None
    return lens


def _identity(lens: Lens) -> str:
    with _IDENTITIES_LOCK:
        identity = _IDENTITIES.get(lens)
        if identity is None:
            identity = secrets.token_urlsafe(24)
            _IDENTITIES[lens] = identity
        return identity


def _binding_name(value: object) -> str:
    name = str(value)
    match = _MANGLED_BINDING.match(name)
    return name if match is None else match.group(1)


def _ordered_names(values: set[str]) -> tuple[str, ...]:
    return tuple(sorted(values, key=lambda name: (name.startswith("_"), name)))


def _bounded(value: object, maximum: int) -> tuple[str, bool]:
    text = str(value or "")
    return text[:maximum], len(text) > maximum


def _identifier(value: object) -> str:
    return _bounded(value, _MAX_IDENTIFIER)[0]


def _preview(value: object, maximum: int = _MAX_NOTE_PREVIEW) -> dict[str, object]:
    text, truncated = _bounded(value, maximum)
    return {"text": text, "truncated": truncated}


def _selection_rows(references: Mapping[str, object]) -> list[Mapping[str, Any]]:
    values = references.get("selections")
    if not isinstance(values, list):
        return []
    return [
        cast(Mapping[str, Any], value) for value in values if isinstance(value, Mapping)
    ]


def _selection_index(
    selection: Mapping[str, Any],
    current_id: object,
) -> dict[str, object]:
    anchor = selection.get("anchor")
    snapshot = selection.get("snapshot")
    return {
        "id": _identifier(selection.get("id")),
        "label": _identifier(selection.get("label")),
        "current": selection.get("id") == current_id,
        "outputCellId": _identifier(selection.get("outputCellId")),
        "cellStatus": _identifier(selection.get("cellStatus")),
        "anchorKind": anchor.get("kind") if isinstance(anchor, Mapping) else None,
        "notePreview": _preview(selection.get("note")),
        "snapshotStatus": (
            snapshot.get("status") if isinstance(snapshot, Mapping) else None
        ),
    }


def _current_selection(selection: Mapping[str, Any] | None) -> dict[str, object] | None:
    if selection is None:
        return None
    snapshot = selection.get("snapshot")
    result: dict[str, object] = {
        "id": _identifier(selection.get("id")),
        "label": _identifier(selection.get("label")),
        "outputCellId": _identifier(selection.get("outputCellId")),
        "cellStatus": _identifier(selection.get("cellStatus")),
        "anchor": selection.get("anchor"),
        "note": _preview(selection.get("note"), _MAX_CURRENT_NOTE),
        "snapshotStatus": (
            snapshot.get("status") if isinstance(snapshot, Mapping) else None
        ),
    }
    dom_hint = selection.get("domHint")
    if isinstance(dom_hint, Mapping):
        dom: dict[str, str] = {}
        truncated = False
        for field_name, maximum in (
            ("tag", 40),
            ("role", 80),
            ("ariaLabel", 160),
            ("title", 160),
            ("text", _MAX_DOM_TEXT),
        ):
            text, field_truncated = _bounded(dom_hint.get(field_name), maximum)
            if text:
                dom[field_name] = text
            truncated = truncated or field_truncated
        if dom:
            result["domHint"] = dom
        if truncated:
            result["domHintTruncated"] = True
    previous = selection.get("previousResolution")
    if isinstance(previous, Mapping):
        addressed_at, _ = _bounded(previous.get("addressedAt"), 80)
        if addressed_at:
            receipt: dict[str, str] = {"addressedAt": addressed_at}
            summary, _ = _bounded(previous.get("summary"), 240)
            if summary:
                receipt["summary"] = summary
            result["previousResolution"] = receipt
    return result


def _notebook_summary(value: object) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    path, path_truncated = _bounded(value.get("path"), _MAX_NOTEBOOK_PATH)
    result: dict[str, object] = {
        "path": path,
        "available": value.get("available") is True,
    }
    if path_truncated:
        result["pathTruncated"] = True
    if value.get("available") is False:
        reason, reason_truncated = _bounded(value.get("reason"), _MAX_REASON)
        result["reason"] = reason
        if reason_truncated:
            result["reasonTruncated"] = True
    return result


def _cell_summary(context: object, cell_id: object) -> dict[str, object] | None:
    if not isinstance(cell_id, str):
        return None
    graph = getattr(context, "graph", None)
    cells = getattr(graph, "cells", None)
    getter = getattr(cells, "get", None)
    if not callable(getter):
        return {"id": _identifier(cell_id), "status": "unavailable"}
    cell = getter(cell_id)
    if cell is None:
        return {"id": _identifier(cell_id), "status": "missing"}
    definitions, omitted_definitions = _graph_names(getattr(cell, "defs", ()))
    references, omitted_references = _graph_names(getattr(cell, "refs", ()))
    result: dict[str, object] = {
        "id": _identifier(cell_id),
        "status": "available",
        "defs": definitions,
        "refs": references,
        "codeCharacters": len(str(getattr(cell, "code", "") or "")),
    }
    if omitted_definitions:
        result["omittedDefCount"] = omitted_definitions
    if omitted_references:
        result["omittedRefCount"] = omitted_references
    return result


def _graph_names(values: object) -> tuple[list[str], int]:
    if not isinstance(values, (set, frozenset, list, tuple)):
        return [], 0
    all_names = sorted(str(value) for value in values)
    included = [
        _bounded(value, _MAX_GRAPH_NAME)[0] for value in all_names[:_MAX_GRAPH_NAMES]
    ]
    return included, max(0, len(all_names) - len(included))


def _require_revision(context: LensContext, expected_revision: int) -> None:
    if context.revision != expected_revision:
        raise LensError(
            "revision_conflict",
            (
                f"Expected Lens revision {expected_revision}, "
                f"but the current revision is {context.revision}."
            ),
            revision=context.revision,
        )


def _find_selection(
    context: LensContext,
    selection_id: str,
) -> Mapping[str, Any]:
    selection = next(
        (
            candidate
            for candidate in _selection_rows(context.references)
            if candidate.get("id") == selection_id
        ),
        None,
    )
    if selection is None:
        raise LensError(
            "selection_not_found",
            "The Lens selection is no longer open.",
            revision=context.revision,
        )
    return selection


def _selection_agent_image(
    image: SelectionImage,
    selection: Mapping[str, Any],
) -> AgentImage:
    return AgentImage(
        source="selection",
        media_type=image.media_type,
        data=image.data,
        width=image.width,
        height=image.height,
        sha256=image.sha256,
        captured_at=image.captured_at,
        cell_id=str(selection["outputCellId"]),
        selection_id=image.selection_id,
        outdated=image.outdated,
    )


def _cell_image_result(result: OutputCaptureResult) -> CellImageResult:
    image = result.image
    if result.status == "available":
        if (
            not isinstance(image, OutputImage)
            or image.request_id != result.request_id
            or image.cell_id != result.cell_id
        ):
            raise RuntimeError("Lens returned an invalid cell image result.")
        agent_image = AgentImage(
            source="cell",
            media_type=image.media_type,
            data=image.data,
            width=image.width,
            height=image.height,
            sha256=image.sha256,
            captured_at=image.captured_at,
            cell_id=image.cell_id,
        )
    else:
        agent_image = None
    return CellImageResult(
        request_id=result.request_id,
        cell_id=result.cell_id,
        selection_ids=result.selection_ids,
        status=result.status,
        image=agent_image,
        error_code=result.error_code,
        error=result.error,
    )


def _encode_transfer(
    *,
    status: Literal["pending", "available", "failed"],
    source: Literal["selection", "cell"],
    cell_id: str,
    request_id: str | None = None,
    selection_id: str | None = None,
    selection_ids: Sequence[str] = (),
    outdated: bool | None = None,
    error_code: str | None = None,
    error: str | None = None,
    image: AgentImage | None = None,
) -> str:
    payload: dict[str, object] = {
        "protocol": "marimo-lens.image-transfer",
        "version": 1,
        "status": status,
        "source": source,
        "cellId": cell_id,
    }
    if request_id is not None:
        payload["requestId"] = request_id
    if selection_id is not None:
        payload["selectionId"] = selection_id
    if selection_ids:
        payload["selectionIds"] = list(selection_ids)
    if outdated is not None:
        payload["outdated"] = outdated
    if error_code is not None:
        payload["errorCode"] = error_code
    if error is not None:
        payload["error"] = error
    if image is not None:
        payload["image"] = {
            "mediaType": image.media_type,
            "bytes": len(image.data),
            "width": image.width,
            "height": image.height,
            "sha256": image.sha256,
            "capturedAt": image.captured_at,
            "data": base64.b64encode(image.data).decode("ascii"),
        }
    return _IMAGE_TRANSFER_PREFIX + json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    )


__all__ = [
    "AgentImage",
    "CellImageResult",
    "MountedLens",
    "discover",
]
