from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import anywidget
import traitlets

from marimo_lens import selection, targets
from marimo_lens.inspectors import ChartEntity, LensEntity, chart_part


class FrameLike:
    columns = ["region", "revenue"]
    dtypes = ["object", "int64"]
    shape = (2, 2)


class TraitThing(traitlets.HasTraits):
    enabled = traitlets.Bool(True)
    name = traitlets.Unicode("demo")


class SecretTraitThing(traitlets.HasTraits):
    api_token = traitlets.Unicode("trait-secret")
    public = traitlets.Unicode("visible")


class SecretWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} }"
    api_token = traitlets.Unicode("widget-secret").tag(sync=True)
    public = traitlets.Unicode("visible").tag(sync=True)


class ShadowGridWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} }"
    title = traitlets.Unicode("Shadow grid").tag(sync=True)
    columns = traitlets.List(
        [
            {"name": "segment", "dtype": "str"},
            {"name": "revenue", "dtype": "int"},
            {"name": "status", "dtype": "str"},
        ]
    ).tag(sync=True)
    rows = traitlets.List(
        [
            {"segment": "Enterprise", "revenue": 142, "status": "watch"},
            {"segment": "Self serve", "revenue": 88, "status": "ok"},
        ]
    ).tag(sync=True)


class SchemaNotMapping:
    columns = None
    schema = object()


class OrdersTable:
    row_count = 7
    schema = [
        ("order_id", "int"),
        ("amount", "float"),
    ]


class OrdersInspector:
    id = "acme.orders"

    def inspect(self, entity: LensEntity) -> targets.TargetMetadata | None:
        if not isinstance(entity.value, OrdersTable):
            return None
        return targets.dataframe(
            id=f"var:{entity.name}",
            label="Orders",
            shape=targets.Shape(rows=entity.value.row_count, columns=2),
            columns=[
                targets.Column(name, dtype) for name, dtype in entity.value.schema
            ],
            capabilities=targets.Capabilities(columnar_dom=True),
            selection=selection.Policy.prefer(
                "columnar-dom",
                "selector",
                context={"api_token": "inspector-secret"},
            ),
            summary=f"{entity.name}: {entity.value.row_count} orders",
            extensions={"family": "orders"},
        )


class CustomChart:
    pass


class CustomChartAdapter:
    id = "custom-chart"

    def inspect(self, chart: ChartEntity) -> Mapping[str, Any] | None:
        assert chart.is_svg_html is False
        if not isinstance(chart.value, CustomChart):
            return None
        return {
            "library": "custom",
            "parts": [
                chart_part("axis", "custom axis", "x", selector="[data-custom-axis]"),
                chart_part("mark", "custom marks"),
            ],
        }


def sales_frame() -> Any:
    import pandas as pd

    return pd.DataFrame(
        {
            "region": ["North", "South"],
            "revenue": [142, 117],
            "margin": [0.31, 0.29],
        }
    )


def lens_entity(
    name: str,
    value: Any,
    *,
    graph: Mapping[str, Any] | None = None,
    cell_id: str | None = None,
    display_cell_ids: tuple[str, ...] = (),
    related_cell_ids: tuple[str, ...] = (),
) -> LensEntity:
    return LensEntity(
        name=name,
        value=value,
        graph=graph or {},
        cell_id=cell_id,
        display_cell_ids=display_cell_ids,
        related_cell_ids=related_cell_ids,
    )
