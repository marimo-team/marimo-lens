from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from marimo_lens._pipeline import LensContext, LensPipeline
from marimo_lens.inspectors import EntityRegistry

from tests.support.sample_entities import FrameLike, OrdersInspector, OrdersTable


def test_lens_pipeline_can_replace_default_inspectors_internally() -> None:
    context = LensPipeline(
        entity_registry=EntityRegistry((OrdersInspector(),)),
    ).collect(
        {"orders": OrdersTable(), "sales": FrameLike()},
        title="marimo lens",
    )

    assert [target["variable"] for target in context.targets] == ["orders"]


def test_lens_pipeline_can_disable_default_inspectors_internally() -> None:
    context = (
        LensPipeline()
        .with_overrides(
            inspectors=[OrdersInspector()],
            use_default_inspectors=False,
        )
        .collect(
            {"orders": OrdersTable(), "sales": FrameLike()},
            title="marimo lens",
        )
    )

    assert [target["variable"] for target in context.targets] == ["orders"]


def test_internal_lens_pipeline_accepts_context_callbacks_and_custom_renderers() -> (
    None
):
    def enrich(context: LensContext) -> LensContext:
        assert "sales" in context.namespace
        return context.with_updates(
            metadata={
                **context.metadata,
                "audience": "agent",
                "api_token": "callback-secret",
            }
        )

    def render_markdown(context: LensContext) -> str:
        return f"custom markdown for {len(context.targets)} targets"

    def render_prompt(context: LensContext) -> str:
        feedback = context.pair_feedback or {}
        extensions = feedback.get("extensions") or {}
        return f"custom prompt: {context.markdown} for {extensions.get('audience')}"

    context = LensPipeline()
    context = context.with_overrides(
        context_callbacks=[enrich],
        markdown_renderer=render_markdown,
        prompt_renderer=render_prompt,
    ).collect(
        {"sales": FrameLike()},
        title="marimo lens",
        annotations=[
            {
                "id": "a1",
                "targetId": "var:sales",
                "targetLabel": "sales",
                "variable": "sales",
                "kind": "dataframe",
                "comment": "Review this table.",
            }
        ],
    )

    feedback = context.pair_feedback or {}

    assert context.metadata["audience"] == "agent"
    assert context.markdown == "custom markdown for 1 targets"
    assert feedback["extensions"]["audience"] == "agent"
    assert feedback["extensions"]["api_token"] == "callback-secret"
    assert (
        context.pair_prompt == "custom prompt: custom markdown for 1 targets for agent"
    )


def test_internal_lens_pipeline_can_replace_collection_steps() -> None:
    def collect_graph(
        namespace: Mapping[str, Any],
        *,
        entity_registry: EntityRegistry,
    ) -> Mapping[str, Any]:
        assert entity_registry.inspect
        assert set(namespace) == {"orders"}
        return {
            "available": True,
            "cells": [
                {
                    "id": "cell-orders",
                    "defs": ["orders"],
                    "refs": [],
                    "codePreview": "orders = load_orders()",
                }
            ],
            "definitions": {"orders": ["cell-orders"]},
            "edges": [],
            "globals": [],
            "controls": {},
        }

    def collect_custom_targets(
        namespace: Mapping[str, Any],
        *,
        include: Sequence[str] | None,
        exclude: Sequence[str] | None,
        graph: Mapping[str, Any],
        entity_registry: EntityRegistry,
    ) -> Sequence[Mapping[str, Any]]:
        assert entity_registry.inspect
        assert include == ["orders"]
        assert exclude is None
        assert graph["definitions"] == {"orders": ["cell-orders"]}
        return [
            {
                "id": "custom:orders",
                "label": "Orders",
                "variable": "orders",
                "kind": "dataframe",
                "cellId": "cell-orders",
                "displayCellIds": ["cell-orders"],
                "relatedCellIds": [],
                "defs": ["orders"],
                "refs": [],
                "shape": {"rows": 10, "columns": 2},
                "columns": [],
                "capabilities": {
                    "columnarDom": True,
                    "columnarGrid": False,
                    "visualSurface": False,
                    "chartPart": False,
                    "media": False,
                    "document": False,
                    "data": False,
                    "diagnostic": False,
                    "interactive": False,
                },
                "summary": "custom collector target",
                "selectors": [],
                "pythonType": "example.Orders",
                "selectionPolicy": {"context": {"api_token": "collector-secret"}},
            }
        ]

    context = LensPipeline(
        graph_collector=collect_graph,
        target_collector=collect_custom_targets,
    ).collect(
        {"orders": object()},
        title="marimo lens",
        include=["orders"],
    )

    assert context.notebook["available"] is True
    assert context.targets[0]["id"] == "custom:orders"
    assert context.targets[0]["summary"] == "custom collector target"
    assert context.targets[0]["selectionPolicy"]["context"]["api_token"] == (
        "collector-secret"
    )
    assert (context.pair_feedback or {})["protocol"] == "marimo-pair.feedback"
