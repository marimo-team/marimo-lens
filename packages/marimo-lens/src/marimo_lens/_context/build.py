"""Build compact references and standalone text from one runtime snapshot."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .._notebook.controls import MAX_CONTROLS, serialize_controls
from .._notebook.provenance import rank_relevant_controls, resolve_provenance
from .._notebook.snapshot import RuntimeSnapshot
from .._selection.references import build_references
from .._selection.state import SelectionState
from .lens_context import LensContext
from .text import render_text


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
) -> LensContext:
    """Project one immutable selection state against one runtime snapshot."""

    selections = state.selections()
    references = build_references(
        snapshot,
        selections,
        revision=state.revision,
        current_selection_id=state.current_selection_id,
    )
    return LensContext._create(
        references=references,
        text=lambda: standalone_text(snapshot, selections, state.current_selection_id),
        images=state.images(),
    )


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
