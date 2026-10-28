"""Build compact references and standalone text from one runtime snapshot."""

from __future__ import annotations

import copy
import pathlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from .._checks import check_selections
from .._core.types import CellReference, LensReferences, RecordedRequest
from .._notebook.controls import MAX_CONTROLS, serialize_controls
from .._notebook.provenance import rank_relevant_controls, resolve_provenance
from .._notebook.snapshot import RuntimeSnapshot
from .._record.lines import OpenRequest, RecordHealth, code_hashes
from .._record.status import RecordStatus
from .._selection.references import build_references
from .._selection.state import SelectionState
from .brief import MOUNTED_CALLS, BriefCalls, current_request, render_brief
from .lens_context import LensContext
from .text import render_text


@dataclass(frozen=True, slots=True)
class RecordView:
    health: RecordHealth
    status: RecordStatus
    image_path: Callable[[str], pathlib.Path | None]


def target_cell_ids(
    selections: Sequence[Mapping[str, Any]],
    current_selection_id: str | None,
) -> tuple[str, ...]:
    """Return unique producer IDs with the current selection first."""

    prioritized = sorted(
        selections,
        key=lambda selection: selection.get("id") != current_selection_id,
    )
    return tuple(
        dict.fromkeys(
            str(cell_id)
            for selection in prioritized
            for cell_id in selection["target"]["cellIds"]
        )
    )


def build_lens_context(
    snapshot: RuntimeSnapshot,
    state: SelectionState,
    *,
    record: RecordView | None,
    chat_requests: Sequence[Mapping[str, Any]],
    opened: Mapping[str, OpenRequest],
    order: Mapping[str, int],
    calls: BriefCalls = MOUNTED_CALLS,
) -> LensContext:
    """Project one selection state, and the record when the Lens keeps one.

    ``opened`` holds the ledger's request for each open selection, so the
    brief can report a producing cell that changed since it opened.
    The brief names ``calls`` to fetch more.
    """

    selections = state.selections()
    references = build_references(
        snapshot,
        selections,
        revision=state.revision,
        current_selection_id=state.current_selection_id,
        record=None if record is None else record.health.reference(),
        code_hashes={
            selection["id"]: code_hashes(
                opened[selection["id"]].baseline, selection["target"]["cellIds"]
            )
            for selection in selections
            if selection["id"] in opened
        },
        chat_requests=chat_requests,
    )
    images = state.images()
    baselines = {
        selection_id: request.baseline for selection_id, request in opened.items()
    }
    current = current_request(
        selections,
        state.current_selection_id,
        chat_requests,
        images,
        order,
    )

    def build_brief() -> str:
        others = [
            request
            for request in (
                *(
                    current_request(selections, selection["id"], (), images)
                    for selection in selections
                ),
                *(current_request((), None, (chat,), images) for chat in chat_requests),
            )
            if request is not None and (current is None or request.id != current.id)
        ]
        checks = [
            diagnostic
            for diagnostic in check_selections(selections, baselines, snapshot)
            if current is not None and diagnostic["requestId"] == current.id
        ]
        return render_brief(
            current,
            snapshot,
            revision=state.revision,
            others=others,
            history=None if record is None else record.status.history,
            checks=checks,
            calls=calls,
        )

    def history(cell_ids: Sequence[str] | None) -> list[RecordedRequest]:
        assert record is not None
        rows = []
        for row in record.status.history(cell_ids):
            image = row["image"]
            if image is not None:
                path = record.image_path(image["sha256"])
                image = {**image, "path": None if path is None else str(path)}
                row = cast("RecordedRequest", {**row, "image": image})
            rows.append(row)
        return rows

    return LensContext._create(
        references=references,
        request=(
            {
                "id": current.id,
                "channel": current.channel,
                "label": current.label,
                "note": current.note,
                "cells": _request_cells(references, current.id),
            }
            if current is not None
            else None
        ),
        text=lambda: standalone_text(snapshot, selections, state.current_selection_id),
        brief=build_brief,
        history=None if record is None else history,
        images=images,
    )


def _request_cells(references: LensReferences, request_id: str) -> list[CellReference]:
    """The cells of the selection or chat reference with ``request_id``."""

    for reference in (*references["selections"], *references["chatRequests"]):
        if reference["id"] == request_id:
            return copy.deepcopy(reference["cells"])
    return []


def standalone_text(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    current_selection_id: str | None,
) -> str:
    """Render the bounded source and runtime text for a text-only handoff."""

    producer_ids = target_cell_ids(selections, current_selection_id)
    provenance = resolve_provenance(snapshot, producer_ids)
    relevant_controls = rank_relevant_controls(snapshot, provenance, producer_ids)
    serialized_controls = serialize_controls(relevant_controls[:MAX_CONTROLS])
    return render_text(
        snapshot,
        selections,
        provenance,
        current_selection_id=current_selection_id,
        serialized_controls=serialized_controls,
        omitted_control_count=max(
            0, len(relevant_controls) - len(serialized_controls.controls)
        ),
    )
