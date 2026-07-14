"""The public marimo Lens anywidget."""

from __future__ import annotations

import json
import pathlib
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import traitlets

from ._anywidget_bundle import Bundle, BundledWidget
from .agent_activity import (
    DEFAULT_AGENT_LABEL,
    build_agent_finished,
    build_agent_started,
    build_annotation_status,
    build_cell_mark,
    build_focus_command,
    build_pair_result,
    render_pair_result_prompt,
)
from ._marimo_runtime import (
    runtime_context as _runtime_context,
    runtime_globals as _runtime_globals,
)
from ._pipeline import LensContext, LensPipeline
from ._widget_traits import (
    apply_context_traits,
    refresh_state,
    render_trait_context,
)
from . import context as lens_context
from .inspectors import EntityInspector
from .metadata import _caller_namespace
from .targets import TargetLike

_BUNDLE = Bundle(
    static_dir=pathlib.Path(__file__).parent / "static",
    dev_server_env="MARIMO_LENS_VITE_DEV_SERVER",
)


class Lens(BundledWidget):
    """A marimo-aware feedback lens exposed as an anywidget.

    The widget has two parts:

    - Python collects notebook/dataflow provenance and typed targets.
    - JavaScript owns the document-level inspection UI and writes feedback back
      through synced traitlets.

    Pass custom ``EntityInspector`` instances for domain-specific target
    metadata. The collection/rendering pipeline stays internal so the public
    widget API stays small while Lens is still young.
    """

    _marimo_lens_widget = True
    bundle = _BUNDLE

    _lens_css = traitlets.Unicode("").tag(sync=True)

    title = traitlets.Unicode("marimo lens").tag(sync=True)
    targets = traitlets.List(default_value=[]).tag(sync=True)
    notebook = traitlets.Dict(default_value={}).tag(sync=True)
    annotations = traitlets.List(default_value=[]).tag(sync=True)
    markdown = traitlets.Unicode("").tag(sync=True)
    pair_feedback = traitlets.Dict(default_value={}).tag(sync=True)
    pair_prompt = traitlets.Unicode("").tag(sync=True)
    agent_activity = traitlets.List(default_value=[]).tag(sync=True)
    agent_commands = traitlets.List(default_value=[]).tag(sync=True)
    pair_result = traitlets.Dict(default_value={}).tag(sync=True)
    pair_result_prompt = traitlets.Unicode("").tag(sync=True)
    _refresh_request = traitlets.Int(0).tag(sync=True)
    _refresh_request_id = traitlets.Unicode("").tag(sync=True)
    _refresh_state = traitlets.Dict(default_value={"status": "idle"}).tag(sync=True)
    _context_revision = traitlets.Int(0).tag(sync=True)

    def __init__(
        self,
        *,
        title: str = "marimo lens",
        include: Sequence[str] | None = None,
        exclude: Sequence[str] | None = None,
        targets: Sequence[TargetLike] | None = None,
        inspectors: Sequence[EntityInspector] | None = None,
        source: lens_context.Source | None = None,
    ) -> None:
        """Create a Lens widget.

        Args:
            title: Human-readable widget title used in exported feedback.
            include: Optional variable names to collect. Defaults to the whole
                useful dataflow graph, ordered by dataframe, table,
                visualization, object, then interactive values.
            exclude: Variable names to omit after include/default discovery.
            targets: Typed manual target specs from ``marimo_lens.targets``.
                Use this for DOM anchors or domain objects that do not exist as
                Python variables.
            inspectors: Object inspectors to prepend to the active registry.
                This is the normal extension point for custom dataframe,
                widget, or domain-object support.
            source: Explicit collection source. Defaults to the active marimo
                runtime. Tests and replay tools should pass
                ``marimo_lens.context.mapping(...)`` or ``from_snapshot(...)``.
        """

        self._source = source or lens_context.runtime()
        self._include = include
        self._exclude = exclude
        self._manual_targets = list(targets or [])
        self._agent_run_id: str | None = None
        self._agent_label = DEFAULT_AGENT_LABEL
        self._pipeline = LensPipeline().with_inspectors(
            inspectors=inspectors,
        )

        namespace = self._namespace_from_source(include_caller=True)
        context = self._pipeline.collect(
            namespace,
            title=title,
            include=include,
            exclude=exclude,
            manual_targets=targets,
            notebook=self._source.notebook,
            cell_outputs=self._source.cell_outputs,
            metadata=self._source.metadata,
        )
        self._lens_context = context

        super().__init__(**context.widget_state())
        self._lens_css = self._css
        self._sync_agent_result()

    @classmethod
    def from_snapshot(
        cls,
        snapshot: lens_context.Snapshot,
        *,
        title: str = "marimo lens",
        include: Sequence[str] | None = None,
        exclude: Sequence[str] | None = None,
        targets: Sequence[TargetLike] | None = None,
        inspectors: Sequence[EntityInspector] | None = None,
    ) -> Lens:
        """Create a Lens from an offline notebook snapshot."""

        return cls(
            title=title,
            include=include,
            exclude=exclude,
            targets=targets,
            inspectors=inspectors,
            source=lens_context.snapshot(snapshot),
        )

    @classmethod
    def restore(
        cls,
        *,
        state: lens_context.State,
        title: str | None = None,
        include: Sequence[str] | None = None,
        exclude: Sequence[str] | None = None,
        targets: Sequence[TargetLike] | None = None,
        inspectors: Sequence[EntityInspector] | None = None,
        source: lens_context.Source | None = None,
    ) -> Lens:
        """Create a Lens and restore annotations plus agent receipts."""

        if source is None:
            if state.source is not None:
                source = state.source
            elif state.snapshot is not None:
                source = lens_context.snapshot(state.snapshot)
        lens = cls(
            title=title or state.title or "marimo lens",
            include=include,
            exclude=exclude,
            targets=state.targets if targets is None else targets,
            inspectors=inspectors,
            source=source,
        )
        with lens.hold_trait_notifications():
            if state.annotations:
                lens.annotations = [
                    dict(annotation) for annotation in state.annotations
                ]
            if state.agent_activity:
                lens.agent_activity = [
                    dict(activity) for activity in state.agent_activity
                ]
            if state.agent_commands:
                lens.agent_commands = [
                    dict(command) for command in state.agent_commands
                ]
        lens._apply_context(lens._render_trait_context())
        lens._sync_agent_result()
        return lens

    @traitlets.observe("annotations", "targets", "notebook", "title")
    def _sync_exports(self, _change: traitlets.Bunch) -> None:
        self._apply_context(self._render_trait_context())

    @traitlets.observe("agent_activity")
    def _sync_agent_exports(self, _change: traitlets.Bunch) -> None:
        self._sync_agent_result()

    @traitlets.observe("_refresh_request")
    def _refresh_requested(self, change: traitlets.Bunch) -> None:
        if change.get("old") == change.get("new"):
            return
        self.refresh_context()

    @traitlets.observe("_refresh_request_id")
    def _refresh_id_requested(self, change: traitlets.Bunch) -> None:
        request_id = str(change.get("new") or "")
        if not request_id or change.get("old") == change.get("new"):
            return
        self.refresh_context(request_id=request_id)

    def refresh_context(self, *, request_id: str | None = None) -> dict[str, Any]:
        """Refresh the notebook graph, targets, and sniffed runtime context."""

        active_request_id = request_id or ""
        self._set_refresh_state(active_request_id, "running")
        try:
            namespace = self._current_namespace()
            context = self._pipeline.collect(
                namespace,
                title=self.title,
                include=self._include,
                exclude=self._exclude,
                manual_targets=self._manual_targets,
                notebook=self._source.notebook,
                cell_outputs=self._source.cell_outputs,
                annotations=self.annotations,
                metadata=self._source.metadata,
            )
            state = context.widget_state()
            with self.hold_trait_notifications():
                self._lens_context = context
                self.notebook = state["notebook"]
                self.targets = state["targets"]
                self.markdown = state["markdown"]
                self.pair_feedback = state["pair_feedback"]
                self.pair_prompt = state["pair_prompt"]
                self._context_revision += 1
            self._set_refresh_state(active_request_id, "success")
        except Exception as exc:
            self._set_refresh_state(
                active_request_id,
                "error",
                f"{type(exc).__name__}: {exc}",
            )
            raise
        return dict(context.notebook)

    def export_markdown(self, *, refresh: bool = True) -> str:
        """Return the latest reviewer-ready markdown feedback."""

        if not refresh and self.markdown:
            return self.markdown
        context = self._export_context(refresh=refresh)
        return context.markdown or ""

    def export_pair_feedback(self, *, refresh: bool = True) -> dict[str, Any]:
        """Return a JSON-safe marimo-pair feedback packet."""

        if not refresh and self.pair_feedback:
            return dict(self.pair_feedback)
        context = self._export_context(refresh=refresh)
        return dict(context.pair_feedback or {})

    def export_pair_prompt(self, *, refresh: bool = True) -> str:
        """Return paste-ready feedback for a marimo-pair agent."""

        if not refresh and self.pair_prompt:
            return self.pair_prompt
        context = self._export_context(refresh=refresh)
        return context.pair_prompt or ""

    def export_pair_json(
        self,
        *,
        indent: int | None = 2,
        refresh: bool = True,
    ) -> str:
        """Return the marimo-pair feedback packet as JSON."""

        return json.dumps(
            self.export_pair_feedback(refresh=refresh),
            indent=indent,
            sort_keys=True,
        )

    def agent_started(
        self,
        run_id: str | None = None,
        label: str = DEFAULT_AGENT_LABEL,
    ) -> str:
        """Record that an agent run has started and return its run id."""

        active_run_id, activity = build_agent_started(run_id=run_id, label=label)
        self._agent_run_id = active_run_id
        self._agent_label = label
        self._append_agent_activity(activity)
        return active_run_id

    def mark_cells(
        self,
        cell_ids: Iterable[Any] | Any,
        kind: str = "read",
        note: Any = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Record that an agent read, claimed, edited, ran, or blocked cells."""

        active_run_id = self._active_agent_run_id(run_id)
        activity = build_cell_mark(
            cell_ids,
            kind=kind,
            note=note,
            run_id=active_run_id,
            label=self._agent_label,
        )
        return self._append_agent_activity(activity)

    def resolve_annotation(
        self,
        annotation_id: Any,
        status: str = "addressed",
        note: Any = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Link an agent status receipt to a human Lens annotation."""

        resolved_annotation_id, resolved_annotation = self._require_annotation(
            annotation_id
        )
        active_run_id = self._active_agent_run_id(run_id)
        activity = build_annotation_status(
            resolved_annotation_id,
            status=status,
            note=note,
            run_id=active_run_id,
            label=self._agent_label,
        )
        activity["details"] = {"annotation": dict(resolved_annotation)}
        return self._append_agent_activity(activity)

    def agent_finished(
        self,
        summary: str,
        run_id: str | None = None,
        status: str = "completed",
        cells_read: Iterable[Any] = (),
        cells_edited: Iterable[Any] = (),
        cells_run: Iterable[Any] = (),
        annotations_addressed: Iterable[Any] = (),
    ) -> dict[str, Any]:
        """Record the final marimo-pair result packet for this Lens."""

        active_run_id = self._active_agent_run_id(run_id)
        activity = build_agent_finished(
            summary=summary,
            run_id=active_run_id,
            status=status,
            label=self._agent_label,
            cells_read=cells_read,
            cells_edited=cells_edited,
            cells_run=cells_run,
            annotations_addressed=annotations_addressed,
        )
        self._agent_run_id = None
        return self._append_agent_activity(activity)

    def focus_cell(self, cell_id: Any, reason: Any = None) -> dict[str, Any]:
        """Queue a lightweight frontend command to focus a notebook cell."""

        command = build_focus_command(cell_id, reason=reason)
        with self.hold_trait_notifications():
            self.agent_commands = [*list(self.agent_commands or []), command]
        return command

    def export_pair_result(self) -> dict[str, Any]:
        """Return the machine-readable marimo-pair result packet."""

        self._sync_agent_result()
        return dict(self.pair_result)

    def export_pair_result_prompt(self) -> str:
        """Return a reviewer-readable marimo-pair result packet."""

        self._sync_agent_result()
        return self.pair_result_prompt

    def _current_namespace(self) -> Mapping[str, Any]:
        return self._namespace_from_source(include_caller=False)

    def _namespace_from_source(self, *, include_caller: bool) -> Mapping[str, Any]:
        if self._source.namespace is not None:
            return self._source.namespace
        if not self._source.auto_collect:
            return {}
        if include_caller:
            return _caller_namespace(skip=3)
        ctx, _reason = _runtime_context()
        return _runtime_globals(ctx)

    @property
    def context(self) -> LensContext:
        """Return the latest Python-side Lens context."""

        return self._lens_context

    def _render_trait_context(self) -> LensContext:
        return render_trait_context(
            pipeline=self._pipeline,
            namespace=self._current_namespace(),
            title=self.title,
            notebook=self.notebook,
            targets=list(self.targets),
            annotations=list(self.annotations),
            metadata=dict(self._source.metadata),
        )

    def _export_context(self, *, refresh: bool) -> LensContext:
        if refresh:
            self.refresh_context()
            return self._lens_context
        return self._render_trait_context()

    def _apply_context(self, context: LensContext) -> None:
        apply_context_traits(self, context)

    def _append_agent_activity(self, item: Mapping[str, Any]) -> dict[str, Any]:
        activity = dict(item)
        with self.hold_trait_notifications():
            self.agent_activity = [*list(self.agent_activity or []), activity]
        self._sync_agent_result()
        return activity

    def _active_agent_run_id(self, run_id: str | None) -> str:
        if run_id:
            self._agent_run_id = run_id
            return run_id
        if self._agent_run_id:
            return self._agent_run_id
        active_run_id, activity = build_agent_started(
            run_id=None,
            label=self._agent_label,
        )
        self._agent_run_id = active_run_id
        self._append_agent_activity(activity)
        return active_run_id

    def _sync_agent_result(self) -> None:
        result = build_pair_result(
            [dict(item) for item in self.agent_activity or []],
            agent_label=self._agent_label,
        )
        prompt = render_pair_result_prompt(result)
        with self.hold_trait_notifications():
            if self.pair_result != result:
                self.pair_result = result
            if self.pair_result_prompt != prompt:
                self.pair_result_prompt = prompt

    def _set_refresh_state(
        self,
        request_id: str,
        status: str,
        error: str = "",
    ) -> None:
        self.set_trait(
            "_refresh_state",
            refresh_state(
                request_id=request_id,
                status=status,
                error=error,
                context_revision=self._context_revision,
            ),
        )

    def _require_annotation(self, annotation_id: Any) -> tuple[str, Mapping[str, Any]]:
        normalized = "" if annotation_id is None else str(annotation_id)
        if not normalized:
            raise ValueError("Lens annotation resolution requires an annotation id")
        annotations = [
            annotation
            for annotation in self.annotations or []
            if isinstance(annotation, Mapping) and annotation.get("id") is not None
        ]
        for annotation in annotations:
            if str(annotation.get("id")) == normalized:
                return normalized, annotation

        known_ids = {str(annotation.get("id")) for annotation in annotations}
        known = ", ".join(sorted(known_ids)) or "none"
        raise ValueError(
            "Cannot resolve unknown Lens annotation "
            f"{normalized!r}. Known annotation ids: {known}"
        )


def find_lens(*, required: bool = True) -> Lens | None:
    """Return the active Lens from marimo runtime globals."""

    ctx, reason = _runtime_context()
    namespace = _runtime_globals(ctx)
    lenses = [
        (str(name), lens)
        for name, value in namespace.items()
        if (lens := _lens_from_value(value)) is not None
    ]
    if not lenses:
        if required:
            detail = f": {reason}" if reason else ""
            raise RuntimeError(
                f"No marimo Lens instance found in runtime globals{detail}"
            )
        return None

    named_lenses = [value for name, value in lenses if name == "lens"]
    if len(named_lenses) == 1:
        return named_lenses[0]
    if len(lenses) == 1:
        return lenses[0][1]

    if not required:
        return None

    names = ", ".join(name for name, _value in lenses)
    raise RuntimeError(
        "Multiple marimo Lens instances found "
        f"({names}). Assign the intended widget to a global named `lens`."
    )


def _lens_from_value(value: Any) -> Lens | None:
    if getattr(value, "_marimo_lens_widget", False):
        return value
    widget = getattr(value, "widget", None)
    if getattr(widget, "_marimo_lens_widget", False):
        return widget
    return None


__all__ = ["Lens", "find_lens"]
