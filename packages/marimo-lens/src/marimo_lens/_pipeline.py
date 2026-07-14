"""Internal Python-side Lens collection and export pipeline."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from ._pair_feedback import (
    build_pair_feedback,
    render_markdown,
    render_pair_prompt,
)
from .context import collect_notebook_graph
from .inspectors import (
    EntityInspector,
    EntityRegistry,
    default_entity_registry,
)
from .metadata import _normalize_targets
from .targets import collect_targets


@dataclass(frozen=True)
class LensContext:
    """Python-side context passed through Lens collection and export callbacks."""

    namespace: Mapping[str, Any] = field(repr=False)
    title: str
    notebook: Mapping[str, Any]
    targets: Sequence[Mapping[str, Any]]
    annotations: Sequence[Mapping[str, Any]]
    metadata: Mapping[str, Any] = field(default_factory=dict)
    markdown: str | None = None
    pair_feedback: Mapping[str, Any] | None = None
    pair_prompt: str | None = None

    def with_updates(self, **updates: Any) -> LensContext:
        """Return a copy with selected fields replaced."""

        return replace(self, **updates)

    def widget_state(self) -> dict[str, Any]:
        """Return the trait values that should be synced to the frontend."""

        return {
            "title": self.title,
            "notebook": dict(self.notebook),
            "targets": [dict(target) for target in self.targets],
            "annotations": [dict(annotation) for annotation in self.annotations],
            "markdown": self.markdown or "",
            "pair_feedback": dict(self.pair_feedback or {}),
            "pair_prompt": self.pair_prompt or "",
        }


@dataclass(frozen=True)
class LensPipeline:
    """Collection and rendering steps used internally by the Lens widget."""

    entity_registry: EntityRegistry = field(default_factory=default_entity_registry)

    def with_inspectors(
        self,
        *,
        inspectors: Sequence[EntityInspector] | None = None,
        use_default_inspectors: bool | None = None,
    ) -> LensPipeline:
        registry = self.entity_registry
        if use_default_inspectors is False and _is_default_entity_registry(
            self.entity_registry
        ):
            registry = EntityRegistry(())
        if inspectors:
            registry = registry.with_inspectors(inspectors, prepend=True)
        return replace(self, entity_registry=registry)

    def collect(
        self,
        namespace: Mapping[str, Any],
        *,
        title: str,
        include: Sequence[str] | None = None,
        exclude: Sequence[str] | None = None,
        manual_targets: Sequence[Any] | None = None,
        notebook: Mapping[str, Any] | None = None,
        cell_outputs: Mapping[str, Any] | None = None,
        annotations: Sequence[Mapping[str, Any]] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> LensContext:
        graph = dict(
            collect_notebook_graph(namespace, entity_registry=self.entity_registry)
            if notebook is None
            else notebook
        )
        inferred_targets = collect_targets(
            namespace,
            include=include,
            exclude=exclude,
            graph=graph,
            cell_outputs=cell_outputs,
            entity_registry=self.entity_registry,
        )
        targets = _merge_unique_targets(
            inferred_targets,
            _normalize_targets(manual_targets),
        )
        context = LensContext(
            namespace=namespace,
            title=title,
            notebook=graph,
            targets=targets,
            annotations=list(annotations or []),
            metadata=dict(metadata or {}),
        )
        return self.render(context)

    def render(self, context: LensContext) -> LensContext:
        """Apply callbacks and render missing export fields."""

        if context.markdown is None:
            context = context.with_updates(
                markdown=render_markdown(context.annotations, context.notebook)
            )
        if context.pair_feedback is None:
            context = context.with_updates(
                pair_feedback=build_pair_feedback(
                    context.annotations,
                    context.notebook,
                    context.targets,
                    title=context.title,
                    markdown=context.markdown or "",
                    metadata=context.metadata,
                )
            )
        if context.pair_prompt is None:
            context = context.with_updates(
                pair_prompt=render_pair_prompt(context.pair_feedback or {})
            )
        return context


def _merge_unique_targets(
    inferred_targets: Sequence[Mapping[str, Any]],
    manual_targets: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    for origin, targets in (
        ("inferred", inferred_targets),
        ("manual", manual_targets),
    ):
        for target in targets:
            item = dict(target)
            target_id = str(item.get("id") or "")
            if not target_id:
                continue
            previous = seen.get(target_id)
            if previous is not None:
                raise ValueError(
                    "Lens target ids must be unique. "
                    f"{target_id!r} appears in both {previous} and {origin} targets"
                )
            seen[target_id] = origin
            merged.append(item)
    return merged


def _is_default_entity_registry(registry: EntityRegistry) -> bool:
    default_ids = tuple(
        inspector.id for inspector in default_entity_registry().inspectors
    )
    actual_ids = tuple(inspector.id for inspector in registry.inspectors)
    return actual_ids == default_ids
