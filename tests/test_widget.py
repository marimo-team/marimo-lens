from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest

import marimo_lens
from marimo_lens import Lens
from marimo_lens import context
from marimo_lens.context import collect_notebook_graph

from tests.support.sample_entities import (
    CustomChart,
    CustomChartAdapter,
    FrameLike,
    OrdersInspector,
    OrdersTable,
)
from tests.support.runtime_contexts import _install_context, _runtime_context


def test_lens_constructs_without_inputs() -> None:
    lens = Lens(source=context.mapping({}))

    assert lens.title == "marimo lens"
    assert isinstance(lens.notebook, dict)
    assert lens.targets == []
    assert lens.pair_feedback["protocol"] == "marimo-pair.feedback"
    assert lens.pair_feedback["source"] == {
        "package": "marimo-lens",
        "title": "marimo lens",
    }
    assert lens.pair_result["protocol"] == "marimo-pair.result"
    assert lens.agent_activity == []
    assert lens.agent_commands == []
    assert lens.pair_prompt == ""


def test_find_lens_prefers_global_named_lens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other = Lens(source=context.mapping({}))
    lens = Lens(source=context.mapping({}))
    _install_context(
        monkeypatch,
        SimpleNamespace(globals={"other": other, "lens": SimpleNamespace(widget=lens)}),
    )

    assert marimo_lens.find_lens(required=False) is lens


def test_find_lens_handles_missing_and_ambiguous_runtime_globals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_context(monkeypatch, SimpleNamespace(globals={}))
    assert marimo_lens.find_lens(required=False) is None

    _install_context(
        monkeypatch,
        SimpleNamespace(
            globals={
                "first": Lens(source=context.mapping({})),
                "second": Lens(source=context.mapping({})),
            }
        ),
    )
    assert marimo_lens.find_lens(required=False) is None
    with pytest.raises(RuntimeError, match="Multiple marimo Lens instances"):
        marimo_lens.find_lens(required=True)


def test_manual_empty_namespace_does_not_fall_back_to_runtime_globals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"secret_df": FrameLike(), "secret_token": "abc"})
    _install_context(monkeypatch, ctx)

    lens = Lens(source=context.mapping({}))
    graph = collect_notebook_graph(namespace={})

    assert lens.targets == []
    assert lens.notebook["globals"] == []
    assert lens.notebook["controls"]["summary"]["uiElementCount"] == 0
    assert graph["globals"] == []


def test_lens_from_snapshot_and_restore_make_state_explicit() -> None:
    snapshot = context.Snapshot(
        namespace={},
        notebook={
            "available": True,
            "cells": [],
            "definitions": {},
            "edges": [],
            "globals": [],
            "controls": {"summary": {}},
        },
    )
    lens = Lens.from_snapshot(snapshot, title="Replay")
    restored = Lens.restore(
        state=context.State(
            title="Restored",
            snapshot=snapshot,
            annotations=[
                {
                    "id": "ml-1",
                    "targetId": "manual:thing",
                    "targetLabel": "Thing",
                    "comment": "Review this.",
                }
            ],
            targets=[marimo_lens.targets.object(id="manual:thing", label="Thing")],
        )
    )

    assert lens.title == "Replay"
    assert lens.notebook["available"] is True
    assert restored.title == "Restored"
    assert restored.annotations[0]["id"] == "ml-1"


def test_lens_reads_runtime_graph_and_globals_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(
        globals={
            "sales": FrameLike(),
            "threshold": 10,
            "helper": lambda value: value,
            "mo": object(),
        }
    )
    _install_context(monkeypatch, ctx)

    def construct_from_current_cell() -> Lens:
        current_cell_value = "available before marimo commits cell globals"
        assert current_cell_value
        return Lens()

    lens = construct_from_current_cell()
    variables = {target["variable"] for target in lens.targets}

    assert lens.notebook["available"] is True
    assert lens.notebook["currentCellId"] == "cell-lens"
    assert lens.notebook["definitions"]["sales"] == ["cell-data"]
    assert {"from": "cell-data", "to": "cell-view"} in lens.notebook["edges"]
    assert variables == {"sales"}
    assert "helper" not in variables
    assert "mo" not in variables


def test_lens_refresh_context_updates_sniffed_ui_state() -> None:
    import marimo as mo

    limit = mo.ui.slider(0, 10, value=3, label="Limit")
    lens = Lens(source=context.mapping({"limit": limit}))
    initial_revision = lens._context_revision

    assert lens.notebook["controls"]["uiElements"][0]["value"] == 3

    limit._update(8)
    refreshed = lens.refresh_context()

    assert lens._context_revision == initial_revision + 1
    assert refreshed["collectedAt"]
    assert refreshed["controls"]["uiElements"][0]["value"] == 8
    assert lens.notebook["controls"]["uiElements"][0]["value"] == 8
    assert lens.export_pair_feedback()["summary"]["uiElementCount"] == 1


def test_raw_pair_feedback_export_refreshes_context_by_default() -> None:
    import marimo as mo

    limit = mo.ui.slider(0, 10, value=2, label="Limit")
    lens = Lens(source=context.mapping({"limit": limit}))

    limit._update(9)
    feedback = lens.export_pair_feedback()

    assert feedback["summary"]["uiElementCount"] == 1
    assert lens.notebook["controls"]["uiElements"][0]["value"] == 9


def test_include_and_exclude_narrow_lens_collection() -> None:
    lens = Lens(
        include=["sales", "threshold", "note"],
        exclude=["threshold"],
        source=context.mapping(
            {"sales": FrameLike(), "threshold": 10, "note": "draft"}
        ),
    )

    assert [target["variable"] for target in lens.targets] == ["sales", "note"]


def test_lens_constructor_has_no_variadic_extension_kwargs() -> None:
    parameters = inspect.signature(Lens).parameters
    public_names = list(parameters)

    assert not any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    )
    assert public_names == [
        "title",
        "include",
        "exclude",
        "targets",
        "inspectors",
        "source",
    ]


def test_lens_inspectors_prepend_custom_entity_support_and_keep_defaults() -> None:
    lens = Lens(
        inspectors=[OrdersInspector()],
        source=context.mapping({"orders": OrdersTable(), "sales": FrameLike()}),
    )
    targets = {target["variable"]: target for target in lens.targets}

    assert targets["orders"]["label"] == "Orders"
    assert targets["orders"]["entity"] == {
        "inspector": "acme.orders",
        "family": "orders",
    }
    assert targets["orders"]["summary"] == "orders: 7 orders"
    assert targets["orders"]["shape"] == {"rows": 7, "columns": 2}
    assert targets["orders"]["columns"][1] == {"name": "amount", "dtype": "float"}
    assert (
        targets["orders"]["selectionPolicy"]["context"]["api_token"]
        == "inspector-secret"
    )
    assert targets["sales"]["entity"]["inspector"] == "tabular"
    assert targets["sales"]["kind"] == "dataframe"


def test_lens_accepts_custom_chart_inspector() -> None:
    lens = Lens(
        inspectors=[
            marimo_lens.charts.Inspector(adapters=[CustomChartAdapter()]),
        ],
        source=context.mapping({"chart": CustomChart()}),
    )
    [target] = lens.targets

    assert target["kind"] == "visualization"
    assert target["chart"]["library"] == "custom"
    assert target["chart"]["parts"][0]["library"] == "custom"
    assert target["chart"]["parts"][0]["label"] == "custom axis"
    assert target["chart"]["parts"][0]["selector"] == "[data-custom-axis]"
    assert target["entity"]["inspector"] == "chart"
