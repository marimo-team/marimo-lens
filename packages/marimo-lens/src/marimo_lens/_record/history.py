"""Project the notebook's record into the History that browsers show.

History is a bounded, read-only view of the record: the newest resolved
requests in both channels, each changed cell with whether the change still
holds, and which open selections each request shaped. It is separate from the
revisioned selection state, so refreshing it never invalidates an agent's
context.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Any

from pydantic import ValidationError

from .._core.bounds import (
    MAX_CELL_NAME,
    MAX_HISTORY_CELL_NAMES,
    MAX_HISTORY_DEFINES,
    MAX_HISTORY_ENTRIES,
    MAX_HISTORY_NOTE,
    MAX_HISTORY_STATEMENT,
    utf16_prefix,
)
from .._schema.selection import SELECTION_ADAPTER, Selection
from .lines import RecordHealth, RecordLine
from .status import RecordStatus

MAX_HISTORY_BYTES = 96_000
# The cell names take at most this share of the budget, so they never crowd
# out every entry.
MAX_HISTORY_CELL_BYTES = 24_000

EMPTY_HISTORY: Mapping[str, Any] = MappingProxyType(
    {
        "entries": [],
        "total": 0,
        "record": {"status": "unsaved"},
        "cells": [],
    }
)


def history_state(
    status: RecordStatus,
    lines: Sequence[RecordLine],
    health: RecordHealth,
    *,
    selections: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    """Return the History trait: newest entries last, within its byte budget.

    ``selections`` maps each open selection to its target cells. An entry
    names the selections it shaped: those whose cells or upstream cells it
    changed or traced. A selection that names no cells is shaped by none.
    """

    rows = status.history(None)
    shaped: dict[tuple[str, str], list[str]] = {}
    for selection_id, cell_ids in selections.items():
        for row in status.history(cell_ids):
            shaped.setdefault((row["id"], row["resolvedAt"]), []).append(selection_id)
    by_key = {(line.id, line.resolved_at): line for line in lines}
    entries: list[dict[str, Any]] = []
    for row in rows[-MAX_HISTORY_ENTRIES:]:
        key = (row["id"], row["resolvedAt"])
        line = by_key.get(key)
        if line is None:
            continue
        entries.append(
            _present(
                {
                    "id": row["id"],
                    "channel": row["channel"],
                    "label": row["label"],
                    "note": utf16_prefix(row["note"], MAX_HISTORY_NOTE),
                    "summary": row["summary"],
                    "openedAt": row["openedAt"],
                    "resolvedAt": row["resolvedAt"],
                    "revision": line.revision,
                    "cellIds": row["cellIds"],
                    "changes": [
                        _present(
                            {
                                "cellId": change["cellId"],
                                "name": utf16_prefix(change["name"], MAX_CELL_NAME)
                                if change["name"]
                                else None,
                                "status": change["status"],
                                "undoneBy": change["undoneBy"],
                                "missing": [
                                    utf16_prefix(statement, MAX_HISTORY_STATEMENT)
                                    for statement in change["missing"]
                                ]
                                or None,
                            }
                        )
                        for change in row["changes"]
                    ],
                    "selection": _selection(line, status.trace(line)),
                    "image": _dump(line.trace.image) if line.trace.image else None,
                    "shaped": shaped.get(key),
                }
            )
        )
    state: dict[str, Any] = {
        "entries": [],
        "total": len(lines),
        "record": health.reference(),
        "cells": [],
    }
    room = MAX_HISTORY_BYTES - _size({**state, "cells": _cells(status, entries)})
    # Keep the newest entries that fit, each measured as browsers receive it.
    # An entry too large for History alone is left out on its own.
    kept: list[dict[str, Any]] = []
    left = room
    for entry in reversed(entries):
        size = _size(entry) + 1
        if size > room:
            continue
        if size > left:
            break
        kept.append(entry)
        left -= size
    kept.reverse()
    state["entries"] = kept
    state["cells"] = _cells(status, kept)
    return state


def _cells(
    status: RecordStatus, entries: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Name the cells History's entries trace or change, newest entries first.

    The names stay within ``MAX_HISTORY_CELL_BYTES``, and cells the notebook
    no longer holds have none.
    """

    mentioned = [
        cell_id
        for entry in reversed(entries)
        for cell_id in (
            *entry["cellIds"],
            *(change.get("cellId") for change in entry["changes"]),
        )
        if cell_id is not None
    ]
    named: list[dict[str, Any]] = []
    for cell_id in dict.fromkeys(mentioned):
        cell = status.cells.get(cell_id)
        if cell is None:
            continue
        named.append(
            _present(
                {
                    "id": cell_id,
                    "name": utf16_prefix(cell.name, MAX_CELL_NAME)
                    if cell.name
                    else None,
                    "defines": [
                        utf16_prefix(name, MAX_CELL_NAME)
                        for name in cell.defs[:MAX_HISTORY_DEFINES]
                    ],
                }
            )
        )
        if len(named) == MAX_HISTORY_CELL_NAMES:
            break
    while named and _size(named) > MAX_HISTORY_CELL_BYTES:
        named.pop()
    return named


def reopened_selection(
    line: RecordLine,
    trace: Mapping[str, str | None],
    *,
    document_id: str,
    document_path: str,
) -> Selection:
    """Return the selection a History entry reopens in the asking document.

    The recorded target moves to the document that asked, because a browser
    document's identity ends when the page reloads. Cell IDs follow each cell
    to the notebook now, since marimo renumbers cells when a kernel restarts.

    Raises:
        ValueError: The line holds no selection, one of its cells is gone, or
            the recorded selection no longer validates.
    """

    if line.channel != "selection" or line.trace.target is None or line.label is None:
        raise ValueError("Only a recorded selection can reopen.")
    target = _current_target(line, trace)
    if target is None:
        raise ValueError("One of the selection's cells is gone.")
    target["documentId"] = document_id
    target["documentPath"] = document_path
    previous: dict[str, Any] = {"resolvedAt": line.resolved_at}
    if line.summary is not None:
        previous["summary"] = line.summary
    try:
        return SELECTION_ADAPTER.validate_python(
            {
                "id": line.id,
                "label": line.label,
                "note": line.note,
                "target": target,
                "createdAt": line.opened_at,
                "anchor": _dump(line.trace.anchor),
                "description": _dump(line.trace.description),
                "snapshot": {"status": "pending"},
                "previousResolution": previous,
            }
        )
    except ValidationError as error:
        raise ValueError(
            "This recorded selection can no longer be reopened."
        ) from error


def _current_target(
    line: RecordLine, trace: Mapping[str, str | None]
) -> dict[str, Any] | None:
    """Return the recorded target with each cell followed to the notebook now.

    marimo renumbers cells when a kernel loads a notebook, so the recorded
    cell IDs and source cell IDs may name other cells. None means a cell is
    gone.
    """

    if line.trace.target is None:
        return None
    target = _dump(line.trace.target)
    sources = target.get("sources", [])
    current: dict[str, str] = {}
    for cell_id in (*target["cellIds"], *(source["cellId"] for source in sources)):
        followed = trace.get(cell_id, cell_id)
        if followed is None:
            return None
        current[cell_id] = followed
    target["cellIds"] = sorted({current[cell_id] for cell_id in target["cellIds"]})
    for source in sources:
        source["cellId"] = current[source["cellId"]]
    return target


def _selection(
    line: RecordLine, trace: Mapping[str, str | None]
) -> dict[str, Any] | None:
    """Return what a History entry reopens, on the recorded cells when one is gone."""

    recorded = line.trace
    if (
        recorded.target is None
        or recorded.anchor is None
        or recorded.description is None
    ):
        return None
    target = _current_target(line, trace) or _dump(recorded.target)
    return {
        "target": target,
        "anchor": _dump(recorded.anchor),
        "description": _dump(recorded.description),
    }


def _present(value: dict[str, Any]) -> dict[str, Any]:
    """Leave out absent fields, which the browser reads as missing keys, not null."""

    return {key: item for key, item in value.items() if item is not None}


def _dump(model: Any) -> Any:
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def _size(state: object) -> int:
    return len(
        json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
