"""Render the brief: an agent's first read for the current request.

The brief names cells by ID and name and values by variable name. It holds no
cell code, values, images, or control state, and it names no code-mode call.
The agent reads those through Lens calls or its own notebook tools.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .._core.bounds import MAX_ATTENTION_MESSAGE
from .._core.types import Diagnostic, RecordedChange, RecordedRequest
from .._notebook.snapshot import (
    RuntimeCell,
    RuntimeSnapshot,
    cell_label,
    cell_state,
)
from .._record.status import UNRECORDED, UNRECORDED_EDIT

MAX_BRIEF_CHARACTERS = 4_000
MAX_BRIEF_NOTE = 1_000
MAX_BRIEF_ROWS = 8

_SHORT_NOTE = 80
_NO_RECORD = "This Lens keeps no record."
_CODES_THE_TRACE_STATES = frozenset({"LV001", "LV002"})


@dataclass(frozen=True, slots=True)
class BriefRequest:
    """The current request as the brief describes it."""

    id: str
    channel: Literal["selection", "chat"]
    note: str
    cell_ids: tuple[str, ...]
    label: str | None = None
    selection: Mapping[str, Any] | None = None
    has_image: bool = False


def current_request(
    selections: Sequence[Mapping[str, Any]],
    current_selection_id: str | None,
    chat_requests: Sequence[Mapping[str, Any]],
    images: Mapping[str, bytes],
    order: Mapping[str, int] | None = None,
) -> BriefRequest | None:
    """Return the request opened last: the current selection or the newest chat.

    ``order`` gives each open request's position in the order requests opened
    or reopened. Timestamps cannot order requests opened within one clock tick.
    A chat request opened after the current selection is the agent's current
    request.
    """

    selection = next(
        (item for item in selections if item["id"] == current_selection_id), None
    )
    chat = chat_requests[-1] if chat_requests else None
    positions = order or {}
    if chat is not None and (
        selection is None
        or positions.get(chat["id"], 0) > positions.get(selection["id"], -1)
    ):
        return BriefRequest(
            id=chat["id"],
            channel="chat",
            note=chat["note"],
            cell_ids=tuple(cell["id"] for cell in chat["cells"]),
        )
    if selection is None:
        return None
    return BriefRequest(
        id=selection["id"],
        channel="selection",
        note=selection["note"],
        cell_ids=tuple(selection["target"]["cellIds"]),
        label=selection["label"],
        selection=selection,
        has_image=selection["id"] in images,
    )


def render_brief(
    request: BriefRequest | None,
    snapshot: RuntimeSnapshot,
    *,
    revision: int,
    others: Sequence[BriefRequest],
    history: Callable[[Sequence[str] | None], list[RecordedRequest]] | None,
    checks: Sequence[Diagnostic] = (),
) -> str:
    """Render the brief for ``request``.

    ``history`` None means the Lens keeps no record: the brief says so and
    its call menu leaves out ``context.history()``.
    """

    if request is None:
        return _bounded(
            "No open request. The analyst has no open selection, and no chat "
            "request is open."
            + (f" {_NO_RECORD}" if history is None else "")
            + "\n\nNext:\n"
            '- mounted.open_request("<the analyst\'s message>", cells=[...]) '
            + ("opens" if history is None else "records")
            + " a request made in chat."
            + (
                ""
                if history is None
                else "\n- context.history() lists every recorded request and "
                "whether its changes still hold."
            )
        )

    cells = {cell.id: cell for cell in (*snapshot.unregistered, *snapshot.cells)}
    title = request.label or request.id
    sections = [
        f"# Request {title} ({request.channel})",
        f"Note: {_quote(request.note, MAX_BRIEF_NOTE) if request.note else '(none)'}",
        _part(request),
        _trace(request, snapshot, cells),
        _checks(checks),
        _earlier(request, history, cells),
        _others(others),
    ]
    # The calls that fetch more stay whole. The sections above them shorten.
    calls = _next(request, revision, recorded=history is not None)
    body = _bounded(
        "\n\n".join(section for section in sections if section),
        max(0, MAX_BRIEF_CHARACTERS - len(calls) - 2),
    )
    return _bounded(f"{body}\n\n{calls}")


def _part(request: BriefRequest) -> str:
    if request.selection is None:
        return "Part: none. A chat request points at no output."
    selection = request.selection
    target = selection["target"]
    anchor = selection["anchor"]
    kind = "a point" if anchor.get("kind") == "point" else "a region"
    where = (
        "the output of its producing cell"
        if target["kind"] == "notebook"
        else f"the DOM target {_json(target['domSelector'])}"
    )
    description = selection.get("description") or {}
    label = description.get("label")
    lines = [
        f"Part: {kind} on {where}" + (f", {_quote(label, 120)}" if label else "") + "."
    ]
    detail = description.get("detail")
    if detail:
        lines.append(f"Detail: {_quote(detail, 200)}.")
    lines.append(
        "Image: the analyst's view is in context.images."
        if request.has_image
        else f"Image: none ({selection['snapshot']['status']})."
    )
    return "\n".join(lines)


def _trace(
    request: BriefRequest,
    snapshot: RuntimeSnapshot,
    cells: Mapping[str, RuntimeCell],
) -> str:
    lines = ["Trace:"]
    if not snapshot.available:
        lines.append(f"- Lens could not read the notebook: {snapshot.reason[:200]}")
    for cell_id in request.cell_ids[:16]:
        cell = cells.get(cell_id)
        if cell is None and cell_id in snapshot.unseen:
            lines.append(
                f"- Cell {_cell(cell_id, cells)}: code out of reach until the next "
                "code-mode call"
            )
        elif cell is None:
            lines.append(f"- Cell {_cell(cell_id, cells)}: not in the notebook")
        else:
            lines.append(f"- Cell {_cell(cell_id, cells)}: {cell_state(cell)}")
    if len(request.cell_ids) > 16:
        lines.append(f"- {len(request.cell_ids) - 16} more cells")
    selection = request.selection or {}
    for source in selection.get("target", {}).get("sources", [])[:16]:
        selector = source.get("selector")
        value = f", value {selector}" if selector else ""
        lines.append(f"- Source: cell {_cell(source['cellId'], cells)}{value}")
    render = (selection.get("description") or {}).get("renderSource")
    if render:
        location = render["path"] + "".join(
            f":{render[key]}" for key in ("line", "column") if key in render
        )
        symbol = f" ({render['symbol']})" if "symbol" in render else ""
        lines.append(f"- Render source: {location[:300]}{symbol[:120]}")
    if len(lines) == 1:
        lines.append(
            "- No cells named. The record keeps each cell the request changes."
        )
    return "\n".join(lines)


def _checks(checks: Sequence[Diagnostic]) -> str:
    shown = [item for item in checks if item["code"] not in _CODES_THE_TRACE_STATES]
    if not shown:
        return ""
    lines = ["Checks:"]
    lines.extend(
        f"- {item['code']} {item['name']}: {item['message']}" for item in shown[:8]
    )
    return "\n".join(lines)


def _earlier(
    request: BriefRequest,
    history: Callable[[Sequence[str] | None], list[RecordedRequest]] | None,
    cells: Mapping[str, RuntimeCell],
) -> str:
    if history is None:
        return f"Earlier requests: none kept. {_NO_RECORD}"
    # A request that names no cells still meets every recorded decision.
    scope = "on these cells and upstream" if request.cell_ids else "in this notebook"
    rows = history(request.cell_ids or None)
    if not rows:
        return f"Earlier requests {scope}: none recorded."
    newest = rows[-1::-1]
    holding = [row for row in newest if _holds(row)]
    ordered = [*holding, *(row for row in newest if not _holds(row))]
    by_id = {row["id"]: row for row in rows}
    lines = [f"Earlier requests {scope}, changes in force first:"]
    for row in ordered[:MAX_BRIEF_ROWS]:
        lines.append(f"- {_request(row)}: {_changes(row, cells, by_id)}")
    if len(rows) > MAX_BRIEF_ROWS:
        lines.append(f"- {len(rows) - MAX_BRIEF_ROWS} more in context.history()")
    return "\n".join(lines)


def _holds(row: RecordedRequest) -> bool:
    return any(change["status"] == "in_force" for change in row["changes"])


def _changes(
    row: RecordedRequest,
    cells: Mapping[str, RuntimeCell],
    rows: Mapping[str, RecordedRequest],
) -> str:
    if not row["changes"]:
        return "pointed at these cells and changed none"
    parts: list[str] = []
    for change in row["changes"][:4]:
        cell_id = change["cellId"]
        if cell_id:
            where = _cell(cell_id, cells, change["name"])
        elif change["status"] == "unknown":
            where = "a cell Lens cannot locate"
        else:
            where = "a deleted cell"
        if change["status"] == "in_force":
            parts.append(f"in force on {where}")
        elif change["status"] == "undone":
            moved = (
                f", code now in {', '.join(_cell(c, cells) for c in change['movedTo'][:3])}"
                if change["movedTo"]
                else ""
            )
            parts.append(
                f"undone on {where}{_undone_by(change, cell_id, cells, rows)}{moved}"
            )
        else:
            parts.append(f"unknown on {where}")
    if len(row["changes"]) > 4:
        parts.append(f"{len(row['changes']) - 4} more changes")
    return "; ".join(parts)


def _undone_by(
    change: RecordedChange,
    cell_id: str | None,
    cells: Mapping[str, RuntimeCell],
    rows: Mapping[str, RecordedRequest],
) -> str:
    """Name the request that undid a change and the other cells it changed.

    A request that undid a change while it rewrote other cells, such as a
    refactor into a new function cell, often carried the lost logic there.
    """

    by = change["undoneBy"]
    if by is None:
        return ""
    if by == UNRECORDED:
        return f" by {UNRECORDED_EDIT}"
    undoing = rows.get(by)
    if undoing is None:
        return f" by {by}"
    others = [
        other["cellId"]
        for other in undoing["changes"]
        if other["cellId"] and other["cellId"] != cell_id
    ]
    title = undoing["label"] or by
    if not others:
        return f" by {title}"
    changed = ", ".join(_cell(other, cells) for other in others[:3])
    return f" by {title}, which also changed {changed}"


def _others(others: Sequence[BriefRequest]) -> str:
    if not others:
        return ""
    lines = ["Other open requests:"]
    for other in others[:MAX_BRIEF_ROWS]:
        note = f" {_quote(other.note, _SHORT_NOTE)}" if other.note else ""
        lines.append(f"- {other.label or other.id} ({other.channel}){note}")
    if len(others) > MAX_BRIEF_ROWS:
        lines.append(f"- {len(others) - MAX_BRIEF_ROWS} more in context.references")
    return "\n".join(lines)


def _next(request: BriefRequest, revision: int, *, recorded: bool) -> str:
    lines = ["Next Lens calls:"]
    if recorded:
        lines.append(
            "- context.history(context.request): earlier requests on its cells "
            "and upstream, with the statements each undone change lost."
            if request.cell_ids
            else "- context.history(): every recorded request, with the statements "
            "each undone change lost."
        )
    if request.has_image:
        lines.append(f"- context.images[{_json(request.id)}]: the PNG the analyst saw.")
    lines.append(
        "- mounted.check() after editing: stale or failed outputs, changed "
        "cells, and record issues."
        if recorded
        else "- mounted.check() after editing: stale or failed outputs and "
        "changed cells."
    )
    lines.append(
        "- mounted.reveal(...), then mounted.resolve("
        f"[{_json(request.id)}], expected_revision={revision}, summary=...), "
        f"with a summary of at most {MAX_ATTENTION_MESSAGE} characters."
    )
    return "\n".join(lines)


def _request(row: RecordedRequest) -> str:
    title = row["label"] or row["id"]
    note = f" {_quote(row['note'], _SHORT_NOTE)}" if row["note"] else ""
    resolved = row["resolvedAt"][:16].replace("T", " ")
    return f"{title} ({row['channel']}, {resolved}){note}"


def _cell(
    cell_id: str, cells: Mapping[str, RuntimeCell], name: str | None = None
) -> str:
    return cell_label(cell_id, cells.get(cell_id), name)


def _quote(text: str, maximum: int) -> str:
    flat = " ".join(text.split())
    if len(flat) > maximum:
        flat = flat[: maximum - 3] + "..."
    return _json(flat)


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def _bounded(text: str, maximum: int = MAX_BRIEF_CHARACTERS) -> str:
    if len(text) <= maximum:
        return text
    notice = "\n[Brief shortened to its 4,000-character budget.]"
    return text[: maximum - len(notice)].rstrip() + notice
