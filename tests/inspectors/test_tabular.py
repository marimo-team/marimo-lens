from __future__ import annotations

from marimo_lens.inspectors import TableInspector, TabularInspector

from tests.support.assertions import _capabilities
from tests.support.sample_entities import (
    FrameLike,
    OrdersTable,
    SchemaNotMapping,
    lens_entity,
)


def test_tabular_inspector_detects_dataframe_like_objects() -> None:
    metadata = TabularInspector().inspect(lens_entity("sales", FrameLike()))

    assert metadata is not None
    assert metadata["kind"] == "dataframe"
    assert metadata["family"] == "tabular"
    assert metadata["shape"] == {"rows": 2, "columns": 2}
    assert metadata["columns"] == [
        {"name": "region", "dtype": "object"},
        {"name": "revenue", "dtype": "int64"},
    ]
    assert metadata["capabilities"] == _capabilities(columnarDom=True)
    assert metadata["selectionPolicy"]["prefer"] == ["columnar-dom", "selector"]


def test_tabular_inspector_tolerates_bad_schema_objects() -> None:
    metadata = TabularInspector().inspect(lens_entity("bad_schema", SchemaNotMapping()))

    assert metadata is None


def test_table_inspector_handles_table_named_objects() -> None:
    metadata = TableInspector().inspect(lens_entity("orders", OrdersTable()))

    assert metadata is not None
    assert metadata["kind"] == "table"
    assert metadata["shape"] is None
    assert metadata["columns"] == []
    assert metadata["capabilities"] == _capabilities()
    assert metadata["selectionPolicy"]["prefer"] == ["selector"]


def test_table_inspector_ignores_non_table_objects() -> None:
    assert TableInspector().inspect(lens_entity("sales", FrameLike())) is None
