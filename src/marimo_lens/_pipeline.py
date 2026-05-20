"""Internal Python-side Lens collection and export pipeline."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

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


class NotebookGraphCollector(Protocol):
    """Collect a notebook graph snapshot from the current namespace."""

    def __call__(
        self,
        namespace: Mapping[str, Any],
        *,
        entity_registry: EntityRegistry,
    ) -> Mapping[str, Any]: ...


class TargetCollector(Protocol):
    """Collect target metadata from a namespace and graph snapshot."""

    def __call__(
        self,
        namespace: Mapping[str, Any],
        *,
        include: Sequence[str] | None,
        exclude: Sequence[str] | None,
        graph: Mapping[str, Any],
        entity_registry: EntityRegistry,
    ) -> Sequence[Mapping[str, Any]]: ...


class ManualTargetNormalizer(Protocol):
    """Validate and normalize user-provided target metadata."""

    def __call__(
        self,
        targets: Sequence[Any] | None,
    ) -> Sequence[Mapping[str, Any]]: ...


class ContextCallback(Protocol):
    """Inspect or enrich a collected Lens context before exports are rendered."""

    def __call__(
        self,
        context: LensContext,
    ) -> LensContext | Mapping[str, Any] | None: ...


class MarkdownRenderer(Protocol):
    """Render reviewer-facing markdown from a collected Lens context."""

    def __call__(self, context: LensContext) -> str: ...


class PairFeedbackBuilder(Protocol):
    """Build the machine-readable marimo-pair packet from a Lens context."""

    def __call__(self, context: LensContext) -> Mapping[str, Any]: ...


class PromptRenderer(Protocol):
    """Render the paste-ready prompt from a Lens context."""

    def __call__(self, context: LensContext) -> str: ...


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


def default_graph_collector(
    namespace: Mapping[str, Any],
    *,
    entity_registry: EntityRegistry,
) -> Mapping[str, Any]:
    return collect_notebook_graph(
        namespace=namespace,
        entity_registry=entity_registry,
    )


def default_target_collector(
    namespace: Mapping[str, Any],
    *,
    include: Sequence[str] | None,
    exclude: Sequence[str] | None,
    graph: Mapping[str, Any],
    entity_registry: EntityRegistry,
) -> Sequence[Mapping[str, Any]]:
    return collect_targets(
        namespace,
        include=include,
        exclude=exclude,
        graph=graph,
        entity_registry=entity_registry,
    )


def default_manual_target_normalizer(
    targets: Sequence[Any] | None,
) -> Sequence[Mapping[str, Any]]:
    return _normalize_targets(targets)


def default_markdown_renderer(context: LensContext) -> str:
    return render_markdown(context.annotations, context.notebook)


def default_pair_feedback_builder(context: LensContext) -> Mapping[str, Any]:
    return build_pair_feedback(
        context.annotations,
        context.notebook,
        context.targets,
        title=context.title,
        markdown=context.markdown or "",
        metadata=context.metadata,
    )


def default_prompt_renderer(context: LensContext) -> str:
    return render_pair_prompt(context.pair_feedback or {})


@dataclass(frozen=True)
class LensPipeline:
    """Collection and rendering steps used internally by the Lens widget."""

    graph_collector: NotebookGraphCollector = default_graph_collector
    target_collector: TargetCollector = default_target_collector
    manual_target_normalizer: ManualTargetNormalizer = default_manual_target_normalizer
    entity_registry: EntityRegistry = field(default_factory=default_entity_registry)
    context_callbacks: Sequence[ContextCallback] = ()
    markdown_renderer: MarkdownRenderer = default_markdown_renderer
    pair_feedback_builder: PairFeedbackBuilder = default_pair_feedback_builder
    prompt_renderer: PromptRenderer = default_prompt_renderer

    def with_overrides(
        self,
        *,
        graph_collector: NotebookGraphCollector | None = None,
        target_collector: TargetCollector | None = None,
        manual_target_normalizer: ManualTargetNormalizer | None = None,
        entity_registry: EntityRegistry | None = None,
        inspectors: Sequence[EntityInspector] | None = None,
        use_default_inspectors: bool | None = None,
        context_callbacks: Sequence[ContextCallback] | None = None,
        markdown_renderer: MarkdownRenderer | None = None,
        pair_feedback_builder: PairFeedbackBuilder | None = None,
        prompt_renderer: PromptRenderer | None = None,
    ) -> LensPipeline:
        callbacks = self.context_callbacks
        if context_callbacks is not None:
            callbacks = (*callbacks, *context_callbacks)
        registry = entity_registry or self.entity_registry
        if (
            use_default_inspectors is False
            and entity_registry is None
            and _is_default_entity_registry(self.entity_registry)
        ):
            registry = EntityRegistry(())
        if inspectors:
            registry = registry.with_inspectors(inspectors, prepend=True)
        return replace(
            self,
            graph_collector=graph_collector or self.graph_collector,
            target_collector=target_collector or self.target_collector,
            manual_target_normalizer=manual_target_normalizer
            or self.manual_target_normalizer,
            entity_registry=registry,
            context_callbacks=callbacks,
            markdown_renderer=markdown_renderer or self.markdown_renderer,
            pair_feedback_builder=pair_feedback_builder or self.pair_feedback_builder,
            prompt_renderer=prompt_renderer or self.prompt_renderer,
        )

    def collect(
        self,
        namespace: Mapping[str, Any],
        *,
        title: str,
        include: Sequence[str] | None = None,
        exclude: Sequence[str] | None = None,
        manual_targets: Sequence[Any] | None = None,
        notebook: Mapping[str, Any] | None = None,
        annotations: Sequence[Mapping[str, Any]] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> LensContext:
        graph = dict(
            self.graph_collector(namespace, entity_registry=self.entity_registry)
            if notebook is None
            else notebook
        )
        inferred_targets = self.target_collector(
            namespace,
            include=include,
            exclude=exclude,
            graph=graph,
            entity_registry=self.entity_registry,
        )
        targets = [
            *[dict(target) for target in _normalize_targets(inferred_targets)],
            *[dict(target) for target in self.manual_target_normalizer(manual_targets)],
        ]
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

        context = self.apply_context_callbacks(context)
        if context.markdown is None:
            context = context.with_updates(markdown=self.markdown_renderer(context))
        if context.pair_feedback is None:
            context = context.with_updates(
                pair_feedback=self.pair_feedback_builder(context)
            )
        if context.pair_prompt is None:
            context = context.with_updates(pair_prompt=self.prompt_renderer(context))
        return context

    def apply_context_callbacks(self, context: LensContext) -> LensContext:
        for callback in self.context_callbacks:
            result = callback(context)
            if result is None:
                continue
            if isinstance(result, LensContext):
                context = result
                continue
            if isinstance(result, Mapping):
                context = context.with_updates(
                    metadata={**context.metadata, **dict(result)}
                )
                continue
            message = (
                "Lens context callbacks must return LensContext, Mapping, or None; "
                f"got {type(result).__module__}.{type(result).__qualname__}"
            )
            raise TypeError(message)
        return context


def _is_default_entity_registry(registry: EntityRegistry) -> bool:
    default_ids = tuple(
        inspector.id for inspector in default_entity_registry().inspectors
    )
    actual_ids = tuple(inspector.id for inspector in registry.inspectors)
    return actual_ids == default_ids
