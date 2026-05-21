from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ._pipeline import LensContext, LensPipeline


def render_trait_context(
    *,
    pipeline: LensPipeline,
    namespace: Mapping[str, Any],
    title: str,
    notebook: Mapping[str, Any],
    targets: Sequence[Mapping[str, Any]],
    annotations: Sequence[Mapping[str, Any]],
    metadata: Mapping[str, Any],
) -> LensContext:
    context = LensContext(
        namespace=namespace,
        title=title,
        notebook=dict(notebook),
        targets=list(targets),
        annotations=list(annotations),
        metadata=dict(metadata),
    )
    return pipeline.render(context)


def apply_context_traits(widget: Any, context: LensContext) -> None:
    state = context.widget_state()
    with widget.hold_trait_notifications():
        widget._lens_context = context
        _set_if_changed(widget, "notebook", state["notebook"])
        _set_if_changed(widget, "targets", state["targets"])
        _set_if_changed(widget, "markdown", state["markdown"])
        _set_if_changed(widget, "pair_feedback", state["pair_feedback"])
        _set_if_changed(widget, "pair_prompt", state["pair_prompt"])


def refresh_state(
    *,
    request_id: str,
    status: str,
    error: str,
    context_revision: int,
) -> dict[str, Any]:
    return {
        "requestId": request_id,
        "status": status,
        "error": error,
        "contextRevision": context_revision,
        "pairPromptRevision": context_revision,
    }


def _set_if_changed(widget: Any, name: str, value: Any) -> None:
    if getattr(widget, name) != value:
        setattr(widget, name, value)
