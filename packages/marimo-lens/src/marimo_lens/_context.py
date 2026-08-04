"""Build compact references and standalone text from one runtime snapshot."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from ._control_state import MAX_CONTROLS, serialize_controls
from ._provenance import rank_relevant_controls, resolve_provenance
from ._references import build_references
from ._runtime import RuntimeSnapshot
from ._selection_state import SelectionState, validate_selection_admission
from ._text_context import render_text
from .context import LensContext, LensReferences


def build_lens_context(
    snapshot: RuntimeSnapshot,
    state: SelectionState,
) -> LensContext:
    """Project one immutable selection state against one runtime snapshot."""

    selections = state.selections()
    references, text_factory = build_context_lazy(
        snapshot,
        selections,
        revision=state.revision,
        current_selection_id=state.current_selection_id,
    )
    return LensContext._create_lazy(
        references=references,
        text_factory=text_factory,
        images=state.images(),
    )


def build_context(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> tuple[LensReferences, str]:
    """Build independent structured and text projections."""

    references, text_factory = build_context_lazy(
        snapshot,
        selections,
        revision=revision,
        current_selection_id=current_selection_id,
    )
    return references, text_factory()


def build_context_lazy(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> tuple[LensReferences, Callable[[], str]]:
    """Build compact references and defer standalone text projection."""

    validate_selection_admission(selections)
    references = build_references(
        snapshot,
        selections,
        revision=revision,
        current_selection_id=current_selection_id,
    )

    def build_text() -> str:
        output_cell_ids = [str(selection["outputCellId"]) for selection in selections]
        provenance = resolve_provenance(snapshot, output_cell_ids)
        relevant_controls = rank_relevant_controls(
            snapshot,
            provenance,
            output_cell_ids,
        )
        serialized_controls = serialize_controls(relevant_controls[:MAX_CONTROLS])
        omitted_control_count = max(
            0,
            len(relevant_controls) - len(serialized_controls.controls),
        )
        return render_text(
            snapshot,
            selections,
            provenance,
            current_selection_id=current_selection_id,
            serialized_controls=serialized_controls,
            omitted_control_count=omitted_control_count,
        )

    return references, build_text


__all__ = [
    "build_context",
    "build_context_lazy",
    "build_lens_context",
]
