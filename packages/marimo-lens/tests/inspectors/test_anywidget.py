from __future__ import annotations

from typing import Any

import anywidget
import pytest

import marimo_lens._runtime_value_metadata as runtime_metadata
from marimo_lens.inspectors import AnyWidgetInspector, MarimoComponentInspector

from tests.support.sample_entities import ShadowGridWidget, lens_entity


def test_anywidget_inspector_exposes_widget_shape_columns_and_policy() -> None:
    metadata = AnyWidgetInspector().inspect(
        lens_entity("shadow_grid", ShadowGridWidget())
    )

    assert metadata is not None
    assert metadata["kind"] == "anywidget"
    assert metadata["shape"] == {"rows": 2, "columns": 3}
    assert metadata["columns"] == [
        {"name": "segment", "dtype": "str"},
        {"name": "revenue", "dtype": "int"},
        {"name": "status", "dtype": "str"},
    ]
    assert metadata["capabilities"]["columnarDom"] is True
    assert metadata["capabilities"]["interactive"] is True
    assert metadata["selectionPolicy"]["prefer"] == [
        "columnar-dom",
        "interactive",
        "selector",
    ]


def test_anywidget_inspector_ignores_non_widgets() -> None:
    assert AnyWidgetInspector().inspect(lens_entity("value", object())) is None


def test_unreadable_anywidget_state_does_not_break_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_state(_widget: anywidget.AnyWidget) -> dict[str, Any]:
        raise RuntimeError("state unavailable")

    monkeypatch.setattr(runtime_metadata, "anywidget_state", raise_state)
    metadata = AnyWidgetInspector().inspect(lens_entity("widget", ShadowGridWidget()))

    assert metadata is not None
    assert metadata["summary"] == "widget: ShadowGridWidget with 1 synced traits"


def test_marimo_anywidget_component_passes_widget_metadata_through() -> None:
    import marimo as mo

    shadow_grid = mo.ui.anywidget(ShadowGridWidget())
    metadata = MarimoComponentInspector().inspect(
        lens_entity("shadow_grid", shadow_grid)
    )

    assert metadata is not None
    assert metadata["kind"] == "anywidget"
    assert metadata["component"] == "marimo-anywidget"
    assert metadata["shape"] == {"rows": 2, "columns": 3}
    assert metadata["columns"] == [
        {"name": "segment", "dtype": "str"},
        {"name": "revenue", "dtype": "int"},
        {"name": "status", "dtype": "str"},
    ]
