"""Build and fit compact live selection references."""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, cast

from ._runtime import RuntimeSnapshot

if TYPE_CHECKING:
    from .context import LensReferences

MAX_CONTEXT_REFERENCES_BYTES = 45_000

_MAX_NOTEBOOK_PATH = 2_048
_MAX_RUNTIME_REASON = 500
_MAX_SAFE_REVISION = 9_007_199_254_740_991
_MAX_GENERATED_AT = "9999-12-31T23:59:59.999999+00:00"


def validate_reference_capacity(
    selections: Sequence[Mapping[str, Any]],
) -> None:
    """Reject identities and geometry that cannot fit compact references."""

    if _minimal_reference_size(selections) > MAX_CONTEXT_REFERENCES_BYTES:
        raise ValueError(
            "Lens selection identities and geometry exceed the shared "
            f"{MAX_CONTEXT_REFERENCES_BYTES:,}-byte context limit."
        )


def _minimal_reference_size(selections: Sequence[Mapping[str, Any]]) -> int:
    projected = [
        _project_selection(
            selection,
            cell_status="unavailable",
            include_previous_resolution=True,
        )
        for selection in selections
    ]
    for selection in projected:
        selection["note"] = ""
        selection.pop("domHint", None)

    current_selection_id = max(
        (str(selection["id"]) for selection in selections),
        key=_serialized_text_size,
        default=None,
    )
    return _reference_size(
        {
            "revision": _MAX_SAFE_REVISION,
            "generatedAt": _MAX_GENERATED_AT,
            "notebook": {"path": "", "available": False, "reason": ""},
            "currentSelectionId": current_selection_id,
            "selections": projected,
        }
    )


def _serialized_text_size(value: str) -> int:
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def build_references(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> LensReferences:
    live_cell_ids = {cell.id for cell in snapshot.cells}
    selection_references = [
        _project_selection(
            selection,
            cell_status=(
                "unavailable"
                if not snapshot.available
                else (
                    "available"
                    if selection["outputCellId"] in live_cell_ids
                    else "missing"
                )
            ),
            include_previous_resolution=selection["id"] == current_selection_id,
        )
        for selection in selections
    ]

    notebook: dict[str, Any] = {
        "path": _safe_text(snapshot.filename, _MAX_NOTEBOOK_PATH),
        "available": snapshot.available,
    }
    if not snapshot.available:
        notebook["reason"] = _safe_text(snapshot.reason, _MAX_RUNTIME_REASON)

    references = {
        "revision": revision,
        "generatedAt": _utcnow(),
        "notebook": notebook,
        "currentSelectionId": current_selection_id,
        "selections": selection_references,
    }
    _fit_reference_budget(references)
    reference_size = _reference_size(references)
    if reference_size > MAX_CONTEXT_REFERENCES_BYTES:
        raise RuntimeError(
            "Lens context references exceeded their serialization budget."
        )
    return cast("LensReferences", references)


def _reference_size(references: Mapping[str, Any]) -> int:
    return len(
        json.dumps(
            references,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _fit_reference_budget(references: dict[str, Any]) -> None:
    if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
        return
    selections = references.get("selections")
    if not isinstance(selections, list):
        return
    current_id = references.get("currentSelectionId")
    secondary = [item for item in selections if item.get("id") != current_id]
    current = [item for item in selections if item.get("id") == current_id]

    notebook = references.get("notebook")
    if isinstance(notebook, dict):
        for field in ("path", "reason"):
            _fit_reference_text(references, notebook, field)
            if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
                return

    _fit_reference_selection_evidence(references, secondary)
    if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
        return

    _fit_reference_selection_evidence(references, current)


def _fit_reference_selection_evidence(
    references: Mapping[str, Any],
    selections: Sequence[dict[str, Any]],
) -> None:
    for selection in selections:
        if selection.pop("domHint", None) is None:
            continue
        if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
            return
    for selection in selections:
        note = selection.get("note")
        if not isinstance(note, str) or not note:
            continue
        _fit_reference_text(references, selection, "note")
        if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
            return


def _fit_reference_text(
    references: Mapping[str, Any],
    target: dict[str, Any],
    field: str,
) -> None:
    value = target.get(field)
    if not isinstance(value, str) or not value:
        return
    target[field] = ""
    if _reference_size(references) > MAX_CONTEXT_REFERENCES_BYTES:
        return

    best = ""
    lower = 0
    upper = len(value) - 1
    while lower <= upper:
        length = (lower + upper) // 2
        candidate = value[:length] + "..."
        target[field] = candidate
        if _reference_size(references) <= MAX_CONTEXT_REFERENCES_BYTES:
            best = candidate
            lower = length + 1
        else:
            upper = length - 1
    target[field] = best


def _project_selection(
    selection: Mapping[str, Any],
    *,
    cell_status: str,
    include_previous_resolution: bool,
) -> dict[str, Any]:
    snapshot = selection.get("snapshot")
    if not isinstance(snapshot, Mapping) or snapshot.get("status") not in {
        "pending",
        "available",
        "failed",
        "outdated",
    }:
        raise RuntimeError("Selection snapshot status is invalid.")
    snapshot_status = str(snapshot["status"])
    item: dict[str, Any] = {
        "id": str(selection["id"]),
        "label": str(selection["label"]),
        "note": str(selection["note"]),
        "outputCellId": str(selection["outputCellId"]),
        "cellStatus": cell_status,
        "anchor": copy.deepcopy(selection["anchor"]),
        "snapshot": {"status": snapshot_status},
    }
    dom_hint = selection.get("domHint")
    if isinstance(dom_hint, Mapping):
        item["domHint"] = copy.deepcopy(dict(dom_hint))
    previous_resolution = selection.get("previousResolution")
    if include_previous_resolution and isinstance(previous_resolution, Mapping):
        item["previousResolution"] = copy.deepcopy(dict(previous_resolution))
    return item


def _safe_text(value: str, maximum: int) -> str:
    sanitized = "".join(
        "\N{REPLACEMENT CHARACTER}" if 0xD800 <= ord(character) <= 0xDFFF else character
        for character in value
    )
    if len(sanitized.encode("utf-8")) <= maximum:
        return sanitized
    result: list[str] = []
    size = 0
    for character in sanitized:
        width = len(character.encode("utf-8"))
        if size + width > maximum - 3:
            break
        result.append(character)
        size += width
    return "".join(result) + "..."


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = [
    "MAX_CONTEXT_REFERENCES_BYTES",
    "build_references",
    "validate_reference_capacity",
]
