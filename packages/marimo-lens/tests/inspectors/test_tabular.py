from __future__ import annotations

from marimo_lens.inspectors import TableInspector, TabularInspector

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
    assert metadata["capabilities"]["columnarDom"] is True
    assert metadata["selectionPolicy"]["prefer"] == ["columnar-dom", "selector"]


def test_tabular_inspector_tolerates_bad_schema_objects() -> None:
    metadata = TabularInspector().inspect(lens_entity("bad_schema", SchemaNotMapping()))

    assert metadata is None


def test_tabular_inspector_tolerates_non_iterable_columns() -> None:
    class NonIterableColumns:
        columns = object()
        shape = (1, 1)

    metadata = TabularInspector().inspect(
        lens_entity("non_iterable_columns", NonIterableColumns())
    )

    assert metadata is None


def test_table_inspector_handles_schema_backed_tables() -> None:
    metadata = TableInspector().inspect(lens_entity("orders", OrdersTable()))

    assert metadata is not None
    assert metadata["kind"] == "table"
    assert metadata["shape"] == {"rows": 7, "columns": 2}
    assert metadata["columns"] == [
        {"name": "order_id", "dtype": "int"},
        {"name": "amount", "dtype": "float"},
    ]
    assert metadata["capabilities"]["columnarDom"] is True
    assert metadata["selectionPolicy"]["prefer"] == ["columnar-dom", "selector"]


def test_table_inspector_handles_pyarrow_schema_objects() -> None:
    class ArrowField:
        def __init__(self, name: str, dtype: str) -> None:
            self.name = name
            self.type = dtype

    class ArrowSchema:
        names = ["order_id", "amount"]

        def field(self, key: str | int) -> ArrowField:
            fields = {
                "order_id": ArrowField("order_id", "int64"),
                "amount": ArrowField("amount", "double"),
            }
            if isinstance(key, int):
                return fields[self.names[key]]
            return fields[key]

    class ArrowTable:
        num_rows = 7
        num_columns = 2
        schema = ArrowSchema()

    metadata = TableInspector().inspect(lens_entity("orders", ArrowTable()))

    assert metadata is not None
    assert metadata["shape"] == {"rows": 7, "columns": 2}
    assert metadata["columns"] == [
        {"name": "order_id", "dtype": "int64"},
        {"name": "amount", "dtype": "double"},
    ]


def test_table_inspector_ignores_non_table_objects() -> None:
    assert TableInspector().inspect(lens_entity("sales", FrameLike())) is None


def test_tabular_inspector_ignores_pyarrow_table_groupby_like_objects() -> None:
    TableGroupBy = type("TableGroupBy", (), {"__module__": "pyarrow.lib"})

    assert TabularInspector().inspect(lens_entity("grouped", TableGroupBy())) is None


def test_table_inspector_ignores_empty_schema_objects() -> None:
    class EmptySchema:
        schema: list[object] = []

    assert TableInspector().inspect(lens_entity("empty", EmptySchema())) is None


def test_table_inspector_ignores_schema_config_without_table_shape() -> None:
    class ConfigLike:
        schema = [{"name": "field", "type": "string"}]

    assert TableInspector().inspect(lens_entity("config", ConfigLike())) is None


def test_tabular_inspector_prefers_schema_names_over_column_arrays() -> None:
    class ArrowField:
        def __init__(self, name: str, dtype: str) -> None:
            self.name = name
            self.type = dtype

    class ArrowLike:
        __module__ = "pyarrow.table"
        schema = [ArrowField("region", "string"), ArrowField("revenue", "int64")]
        columns = [["North", "South"], [142, 117]]
        shape = (2, 2)

    metadata = TabularInspector().inspect(lens_entity("arrow_table", ArrowLike()))

    assert metadata is not None
    assert metadata["columns"] == [
        {"name": "region", "dtype": "string"},
        {"name": "revenue", "dtype": "int64"},
    ]
