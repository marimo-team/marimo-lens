"""Agent activity receipts for the marimo-lens / marimo-pair loop."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

from ._contract import (
    AGENT_ACTIVITY_KINDS,
    AGENT_ANNOTATION_STATUSES,
    AGENT_CELL_MARK_STATUSES,
    AGENT_FINISH_STATUSES,
)
from ._serialization import jsonable, safe_value

AGENT_ACTIVITY_PROTOCOL = "marimo-lens.agent-activity"
AGENT_ACTIVITY_VERSION = 1
PAIR_RESULT_PROTOCOL = "marimo-pair.result"
PAIR_RESULT_VERSION = 1
DEFAULT_AGENT_LABEL = "marimo-pair"

CELL_MARK_KINDS = frozenset(AGENT_CELL_MARK_STATUSES)
ANNOTATION_STATUSES = frozenset(AGENT_ANNOTATION_STATUSES)
FINISH_STATUSES = frozenset(AGENT_FINISH_STATUSES)
_SUMMARY_CELL_STATUSES = {
    "read": "cellsRead",
    "edited": "cellsEdited",
    "ran": "cellsRun",
}
_QUESTION_STATUSES = frozenset(("needs-review", "needs_human", "blocked"))
_WARNING_STATUSES = frozenset(("failed", "blocked"))


def new_run_id() -> str:
    return f"run-{_timestamp_slug()}-{uuid.uuid4().hex[:8]}"


def build_agent_started(
    *,
    run_id: str | None,
    label: str = DEFAULT_AGENT_LABEL,
) -> tuple[str, dict[str, Any]]:
    active_run_id = run_id or new_run_id()
    return active_run_id, _activity(
        "agent-started",
        status="started",
        label=label,
        run_id=active_run_id,
    )


def build_cell_mark(
    cell_ids: Iterable[Any] | Any,
    *,
    kind: str,
    note: Any = None,
    run_id: str | None,
    label: str = DEFAULT_AGENT_LABEL,
) -> dict[str, Any]:
    if kind not in CELL_MARK_KINDS:
        valid = ", ".join(sorted(CELL_MARK_KINDS))
        raise ValueError(f"Unknown Lens agent cell mark kind: {kind}. Valid: {valid}")
    normalized_cell_ids = _strings(cell_ids)
    if not normalized_cell_ids:
        raise ValueError("Lens agent cell marks require at least one cell id")
    return _activity(
        "cell-mark",
        status=kind,
        label=label,
        run_id=run_id or new_run_id(),
        cell_ids=normalized_cell_ids,
        note=note,
    )


def build_annotation_status(
    annotation_id: Any,
    *,
    status: str,
    note: Any = None,
    run_id: str | None,
    label: str = DEFAULT_AGENT_LABEL,
) -> dict[str, Any]:
    if status not in ANNOTATION_STATUSES:
        valid = ", ".join(sorted(ANNOTATION_STATUSES))
        raise ValueError(f"Unknown Lens annotation status: {status}. Valid: {valid}")
    annotation_ids = _strings([annotation_id])
    if not annotation_ids:
        raise ValueError("Lens annotation resolution requires an annotation id")
    return _activity(
        "annotation-status",
        status=status,
        label=label,
        run_id=run_id or new_run_id(),
        annotation_ids=annotation_ids,
        note=note,
    )


def build_agent_finished(
    *,
    summary: str,
    run_id: str | None,
    status: str = "completed",
    label: str = DEFAULT_AGENT_LABEL,
    cells_read: Iterable[Any] = (),
    cells_edited: Iterable[Any] = (),
    cells_run: Iterable[Any] = (),
    annotations_addressed: Iterable[Any] = (),
) -> dict[str, Any]:
    if status not in FINISH_STATUSES:
        valid = ", ".join(sorted(FINISH_STATUSES))
        raise ValueError(f"Unknown Lens agent finish status: {status}. Valid: {valid}")
    read = _strings(cells_read)
    edited = _strings(cells_edited)
    run = _strings(cells_run)
    addressed = _strings(annotations_addressed)
    return _activity(
        "agent-finished",
        status=status,
        label=label,
        run_id=run_id or new_run_id(),
        cell_ids=_unique([*read, *edited, *run]),
        annotation_ids=addressed,
        note=summary,
        details={
            "cellsRead": read,
            "cellsEdited": edited,
            "cellsRun": run,
            "annotationsAddressed": addressed,
        },
    )


def build_focus_command(cell_id: Any, *, reason: Any = None) -> dict[str, Any]:
    cell_ids = _strings([cell_id])
    if not cell_ids:
        raise ValueError("Lens focus_cell requires a cell id")
    command: dict[str, Any] = {
        "id": _prefixed_id("cmd"),
        "kind": "focus-cell",
        "createdAt": _now(),
        "cellId": cell_ids[0],
        "provenance": _provenance(DEFAULT_AGENT_LABEL),
    }
    if reason is not None:
        command["reason"] = _text(reason)
    return command


def build_pair_result(
    activity: Sequence[Mapping[str, Any]],
    *,
    agent_label: str = DEFAULT_AGENT_LABEL,
) -> dict[str, Any]:
    items = [dict(jsonable(item)) for item in activity]
    latest_finish = _latest_activity(items, "agent-finished")
    summary = (
        _finish_summary(latest_finish)
        if latest_finish is not None
        else _activity_summary(items)
    )
    return {
        "protocol": PAIR_RESULT_PROTOCOL,
        "version": PAIR_RESULT_VERSION,
        "source": {
            "package": "marimo-lens",
            "agent": _latest_label(items) or agent_label,
        },
        "summary": summary,
        "activity": items,
        "openQuestions": _open_questions(items),
        "warnings": _warnings(items),
    }


def render_pair_result_prompt(result: Mapping[str, Any]) -> str:
    if not result.get("activity"):
        return ""
    packet = json.dumps(result, indent=2, sort_keys=True)
    return f"""# marimo-pair result packet

The agent reported notebook work through marimo-lens. Review this packet alongside the visible Lens activity regions in the notebook.

```json
{packet}
```"""


def _activity(
    kind: str,
    *,
    status: str,
    label: str,
    run_id: str,
    cell_ids: Sequence[str] = (),
    annotation_ids: Sequence[str] = (),
    note: Any = None,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if kind not in AGENT_ACTIVITY_KINDS:
        raise ValueError(f"Unknown Lens agent activity kind: {kind}")
    item: dict[str, Any] = {
        "id": _prefixed_id("act"),
        "kind": kind,
        "actor": {
            "type": "agent",
            "label": _text(label) or DEFAULT_AGENT_LABEL,
            "runId": _text(run_id),
        },
        "createdAt": _now(),
        "cellIds": list(cell_ids),
        "annotationIds": list(annotation_ids),
        "status": status,
        "provenance": _provenance(label),
    }
    if note is not None:
        item["note"] = _text(note)
    if details:
        item["details"] = safe_value(details)
    return item


def _provenance(label: str) -> dict[str, Any]:
    return {
        "origin": "agent",
        "source": _text(label) or DEFAULT_AGENT_LABEL,
        "protocol": AGENT_ACTIVITY_PROTOCOL,
        "version": AGENT_ACTIVITY_VERSION,
    }


def _finish_summary(item: Mapping[str, Any]) -> dict[str, int]:
    raw_details = item.get("details")
    details: Mapping[str, Any] = raw_details if isinstance(raw_details, Mapping) else {}
    return {
        "cellsRead": len(_strings(details.get("cellsRead", ()))),
        "cellsEdited": len(_strings(details.get("cellsEdited", ()))),
        "cellsRun": len(_strings(details.get("cellsRun", ()))),
        "annotationsAddressed": len(_strings(details.get("annotationsAddressed", ()))),
    }


def _activity_summary(items: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counters = {name: set() for name in _SUMMARY_CELL_STATUSES.values()}
    addressed: set[str] = set()
    for item in items:
        if item.get("kind") == "cell-mark":
            counter = _SUMMARY_CELL_STATUSES.get(str(item.get("status") or ""))
            if counter is not None:
                counters[counter].update(_strings(item.get("cellIds", ())))
        elif item.get("kind") == "annotation-status" and item.get("status") == (
            "addressed"
        ):
            addressed.update(_strings(item.get("annotationIds", ())))
    return {
        "cellsRead": len(counters["cellsRead"]),
        "cellsEdited": len(counters["cellsEdited"]),
        "cellsRun": len(counters["cellsRun"]),
        "annotationsAddressed": len(addressed),
    }


def _open_questions(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for item in items:
        status = item.get("status")
        if status not in _QUESTION_STATUSES:
            continue
        questions.append(
            {
                "activityId": item.get("id") or "",
                "cellIds": _strings(item.get("cellIds", ())),
                "annotationIds": _strings(item.get("annotationIds", ())),
                "note": item.get("note") or "",
            }
        )
    return questions


def _warnings(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for item in items:
        if item.get("status") not in _WARNING_STATUSES:
            continue
        warnings.append(
            {
                "activityId": item.get("id") or "",
                "status": item.get("status") or "",
                "cellIds": _strings(item.get("cellIds", ())),
                "note": item.get("note") or "",
            }
        )
    return warnings


def _latest_activity(
    items: Sequence[Mapping[str, Any]],
    kind: str,
) -> Mapping[str, Any] | None:
    for item in reversed(items):
        if item.get("kind") == kind:
            return item
    return None


def _latest_label(items: Sequence[Mapping[str, Any]]) -> str | None:
    for item in reversed(items):
        actor = item.get("actor")
        if isinstance(actor, Mapping) and actor.get("label"):
            return str(actor["label"])
    return None


def _strings(values: Iterable[Any] | Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        raw_values = [values]
    elif isinstance(values, Mapping | bytes | bytearray):
        raw_values = [values]
    elif isinstance(values, Iterable):
        raw_values = list(values)
    else:
        raw_values = [values]
    return _unique(str(value) for value in raw_values if str(value))


def _unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _text(value: Any) -> str:
    return str(safe_value(value))[:500]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _prefixed_id(prefix: str) -> str:
    return f"{prefix}-{_timestamp_slug()}-{uuid.uuid4().hex[:10]}"
