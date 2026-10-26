"""Build and fit compact live selection references."""

from __future__ import annotations

import copy
import json
from collections.abc import Collection, Mapping, Sequence
from typing import TYPE_CHECKING, Any, cast

from .._core.bounds import MAX_SAFE_INTEGER, safe_text, utcnow
from .._notebook.snapshot import RuntimeSnapshot

if TYPE_CHECKING:
    from .._core.types import (
        CellReference,
        CellStatus,
        LensReferences,
        RecordReference,
    )

MAX_CONTEXT_REFERENCES_BYTES = 64_000
MAX_CHAT_REFERENCES_BYTES = 24_000

_MAX_NOTEBOOK_PATH = 2_048
_MAX_RUNTIME_REASON = 500
_MAX_GENERATED_AT = "9999-12-31T23:59:59.999999+00:00"
# The longest value a cell reference's `status` and `codeHash` take.
_LONGEST_STATUS = "unavailable"
_LONGEST_CODE_HASH = "0" * 16


def chat_reference_size(chat_requests: Sequence[Mapping[str, Any]]) -> int:
    """Return the size of chat request references with empty notes.

    Each cell counts with its longest status, which the context adds later.
    """

    return _reference_size(
        {
            "chatRequests": [
                {
                    **request,
                    "note": "",
                    "cells": [
                        {**cell, "status": _LONGEST_STATUS} for cell in request["cells"]
                    ],
                }
                for request in chat_requests
            ]
        }
    )


def cell_references(
    cell_ids: Sequence[str],
    code_hashes: Mapping[str, str | None],
    *,
    live_cell_ids: Collection[str],
    runtime_available: bool,
) -> list[CellReference]:
    """Each cell's reference: whether the notebook has it now, and its code then."""

    def status(cell_id: str) -> CellStatus:
        if not runtime_available:
            return "unavailable"
        return "available" if cell_id in live_cell_ids else "missing"

    return [
        {"id": cell_id, "status": status(cell_id), "codeHash": code_hashes.get(cell_id)}
        for cell_id in cell_ids
    ]


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
            code_hashes={
                cell_id: _LONGEST_CODE_HASH for cell_id in _target_cell_ids(selection)
            },
            live_cell_ids=set(),
            runtime_available=False,
            include_previous_resolution=True,
        )
        for selection in selections
    ]
    for selection in projected:
        selection["note"] = ""
        selection.pop("domHint", None)
        selection.pop("description", None)
        selection["snapshot"].pop("error", None)

    current_selection_id = max(
        (str(selection["id"]) for selection in selections),
        key=_serialized_text_size,
        default=None,
    )
    return _reference_size(
        {
            "revision": MAX_SAFE_INTEGER,
            "generatedAt": _MAX_GENERATED_AT,
            "notebook": {
                "path": "",
                "available": False,
                "reason": "",
                "record": {"status": "unsaved", "reason": ""},
            },
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
    record: RecordReference | None,
    code_hashes: Mapping[str, Mapping[str, str]],
    chat_requests: Sequence[Mapping[str, Any]] = (),
) -> LensReferences:
    """Project open selections and chat requests into bounded references.

    ``code_hashes`` maps each selection ID to the ``code_hash`` of its
    producing cells when its request opened. Chat requests carry their own.
    """

    live_cell_ids = snapshot.available_cell_ids
    selection_references = [
        _project_selection(
            selection,
            code_hashes=code_hashes.get(str(selection["id"]), {}),
            live_cell_ids=live_cell_ids,
            runtime_available=snapshot.available,
            include_previous_resolution=selection["id"] == current_selection_id,
        )
        for selection in selections
    ]

    notebook: dict[str, Any] = {
        "path": safe_text(snapshot.filename, _MAX_NOTEBOOK_PATH),
        "available": snapshot.available,
    }
    if not snapshot.available:
        notebook["reason"] = safe_text(snapshot.reason, _MAX_RUNTIME_REASON)
    notebook["record"] = record

    chats = {
        "chatRequests": [
            {
                **request,
                "cells": cell_references(
                    [cell["id"] for cell in request["cells"]],
                    {cell["id"]: cell["codeHash"] for cell in request["cells"]},
                    live_cell_ids=live_cell_ids,
                    runtime_available=snapshot.available,
                ),
            }
            for request in chat_requests
        ]
    }
    for request in chats["chatRequests"]:
        if _reference_size(chats) <= MAX_CHAT_REFERENCES_BYTES:
            break
        _fit_reference_text(chats, request, "note", MAX_CHAT_REFERENCES_BYTES)
    if _reference_size(chats) > MAX_CHAT_REFERENCES_BYTES:
        raise RuntimeError("Lens chat requests exceeded their reference budget.")
    budget = MAX_CONTEXT_REFERENCES_BYTES + _reference_size(chats)
    references = {
        "revision": revision,
        "generatedAt": utcnow(),
        "notebook": notebook,
        "currentSelectionId": current_selection_id,
        "selections": selection_references,
        **chats,
    }
    _fit_reference_budget(references, budget)
    reference_size = _reference_size(references)
    if reference_size > budget:
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


def _fit_reference_budget(references: dict[str, Any], budget: int) -> None:
    if _reference_size(references) <= budget:
        return
    selections = references.get("selections")
    if not isinstance(selections, list):
        return
    current_id = references.get("currentSelectionId")
    secondary = [item for item in selections if item.get("id") != current_id]
    current = [item for item in selections if item.get("id") == current_id]

    notebook = references.get("notebook")
    if isinstance(notebook, dict):
        for target, field in (
            (notebook, "path"),
            (notebook, "reason"),
            (notebook.get("record"), "reason"),
        ):
            if isinstance(target, dict):
                _fit_reference_text(references, target, field, budget)
            if _reference_size(references) <= budget:
                return

    _fit_reference_selection_evidence(references, secondary, budget)
    if _reference_size(references) <= budget:
        return

    _fit_reference_selection_evidence(references, current, budget)


def _fit_reference_selection_evidence(
    references: Mapping[str, Any],
    selections: Sequence[dict[str, Any]],
    budget: int,
) -> None:
    for field in ("domHint", "description"):
        for selection in selections:
            if selection.pop(field, None) is None:
                continue
            if _reference_size(references) <= budget:
                return

    for selection in selections:
        if selection["snapshot"].pop("error", None) is None:
            continue
        if _reference_size(references) <= budget:
            return

    for selection in selections:
        note = selection.get("note")
        if not isinstance(note, str) or not note:
            continue
        _fit_reference_text(references, selection, "note", budget)
        if _reference_size(references) <= budget:
            return


def _fit_reference_text(
    references: Mapping[str, Any],
    target: dict[str, Any],
    field: str,
    budget: int,
) -> None:
    value = target.get(field)
    if not isinstance(value, str) or not value:
        return
    target[field] = ""
    if _reference_size(references) > budget:
        return

    best = ""
    lower = 0
    upper = len(value) - 1
    while lower <= upper:
        length = (lower + upper) // 2
        candidate = value[:length] + "..."
        target[field] = candidate
        if _reference_size(references) <= budget:
            best = candidate
            lower = length + 1
        else:
            upper = length - 1
    target[field] = best


def _project_selection(
    selection: Mapping[str, Any],
    *,
    code_hashes: Mapping[str, str | None],
    live_cell_ids: Collection[str],
    runtime_available: bool,
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
        "description": copy.deepcopy(selection["description"]),
        "target": copy.deepcopy(selection["target"]),
        "cells": cell_references(
            _target_cell_ids(selection),
            code_hashes,
            live_cell_ids=live_cell_ids,
            runtime_available=runtime_available,
        ),
        "anchor": copy.deepcopy(selection["anchor"]),
        "snapshot": {"status": snapshot_status},
    }
    error = snapshot.get("error")
    if snapshot_status == "failed" and isinstance(error, str) and error:
        item["snapshot"]["error"] = error
    dom_hint = selection.get("domHint")
    if isinstance(dom_hint, Mapping):
        item["domHint"] = copy.deepcopy(dict(dom_hint))
    previous_resolution = selection.get("previousResolution")
    if include_previous_resolution and isinstance(previous_resolution, Mapping):
        item["previousResolution"] = copy.deepcopy(dict(previous_resolution))
    return item


def _target_cell_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    target = selection.get("target")
    if not isinstance(target, Mapping):
        return ()
    cell_ids = target.get("cellIds")
    if not isinstance(cell_ids, Sequence) or isinstance(
        cell_ids, (str, bytes, bytearray)
    ):
        return ()
    return tuple(str(cell_id) for cell_id in cell_ids)
