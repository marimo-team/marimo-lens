from __future__ import annotations

import pytest

from marimo_lens._pipeline import LensPipeline
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
        .with_inspectors(
            inspectors=[OrdersInspector()],
            use_default_inspectors=False,
        )
        .collect(
            {"orders": OrdersTable(), "sales": FrameLike()},
            title="marimo lens",
        )
    )

    assert [target["variable"] for target in context.targets] == ["orders"]


def test_lens_pipeline_renders_the_canonical_feedback_contract() -> None:
    context = LensPipeline().collect(
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
        metadata={"audience": "agent", "api_token": "metadata-secret"},
    )

    feedback = context.pair_feedback or {}

    assert context.metadata == {"audience": "agent", "api_token": "metadata-secret"}
    assert "Review this table." in (context.markdown or "")
    assert "marimo-pair feedback packet" in (context.pair_prompt or "")
    assert feedback["extensions"]["audience"] == "agent"
    assert feedback["extensions"]["api_token"] == "metadata-secret"
    assert feedback["protocol"] == "marimo-pair.feedback"
    assert feedback["annotations"][0]["target"]["id"] == "var:sales"


def test_lens_pipeline_rejects_duplicate_inferred_and_manual_target_ids() -> None:
    with pytest.raises(ValueError, match="target ids must be unique"):
        LensPipeline().collect(
            {"sales": FrameLike()},
            title="marimo lens",
            manual_targets=[
                {
                    "id": "var:sales",
                    "label": "Sales duplicate",
                    "kind": "dataframe",
                }
            ],
        )


def test_lens_pipeline_uses_explicit_notebook_snapshots_without_collector_swap() -> (
    None
):
    context = LensPipeline(
        entity_registry=EntityRegistry((OrdersInspector(),))
    ).collect(
        {"orders": OrdersTable()},
        title="marimo lens",
        include=["orders"],
        notebook={
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
        },
        cell_outputs={},
    )

    assert context.notebook["available"] is True
    assert context.targets[0]["id"] == "var:orders"
    assert context.targets[0]["cellId"] == "cell-orders"
    assert (context.pair_feedback or {})["protocol"] == "marimo-pair.feedback"
