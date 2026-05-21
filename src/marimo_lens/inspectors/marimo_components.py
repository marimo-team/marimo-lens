"""Semantic inspectors for first-class marimo UI components."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .._marimo_runtime import is_marimo_ui_element, marimo_component
from .._serialization import safe_value
from ._core import LensEntity
from ._metadata import (
    columns,
    control_summary,
    read_value,
    shape,
    inspected_target,
    tabular_summary,
    visualization_summary,
)
from .charts._metadata import (
    chart_part,
    chart_spec_fields,
    chart_spec_parts,
    dedupe_chart_parts,
    with_chart_library,
)
from .charts.plotly import plotly_chart_metadata_from_spec


class MarimoComponentInspector:
    """Inspect marimo UI components whose args carry richer target metadata."""

    id = "marimo-component"

    def inspect(self, entity: LensEntity) -> Mapping[str, Any] | None:
        value = entity.value
        if not is_marimo_ui_element(value):
            return None

        component = marimo_component(value)
        name = component.name
        args = component.args
        handler = _COMPONENT_HANDLERS.get(name)
        if not name or handler is None:
            return None

        return handler(entity, value, name, args, component.label)


_TABULAR_COMPONENTS = frozenset(
    {
        "marimo-data-editor",
        "marimo-dataframe",
        "marimo-table",
    }
)
_TABULAR_SURFACES = {
    "marimo-data-editor": "columnar-grid",
}
_CHART_COMPONENTS = frozenset(
    {
        "marimo-matplotlib",
        "marimo-mpl-interactive",
        "marimo-panel",
        "marimo-plotly",
        "marimo-vega",
    }
)
_CHART_COMPONENT_CONFIG: Mapping[str, Mapping[str, str]] = {
    "marimo-vega": {"library": "vega"},
    "marimo-plotly": {"library": "plotly"},
    "marimo-matplotlib": {"library": "matplotlib"},
    "marimo-mpl-interactive": {
        "library": "matplotlib",
        "renderer": "interactive",
    },
    "marimo-panel": {"library": "panel", "renderer": "iframe"},
}
_LAYOUT_COMPONENTS = frozenset(
    {
        "marimo-accordion",
        "marimo-carousel",
        "marimo-callout",
        "marimo-nav-menu",
        "marimo-sidebar",
        "marimo-stat",
        "marimo-tabs",
    }
)


def _anywidget_target(
    entity: LensEntity,
    value: Any,
    name: str,
    args: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    value_columns = columns(value)
    value_shape = shape(value)
    return inspected_target(
        kind="anywidget",
        family="interactive",
        component=name,
        component_metadata=_component_metadata(args),
        shape=value_shape,
        columns=value_columns,
        capability_flags={"columnar_dom": bool(value_columns), "interactive": True},
        surfaces=("columnar-dom" if value_columns else "", "interactive"),
        summary=control_summary(entity.name, value, name, args, label=label),
    )


def _tabular_target(
    entity: LensEntity,
    value: Any,
    name: str,
    args: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    value_columns = _component_columns(value, args)
    value_shape = _component_shape(value, args, value_columns)
    columnar_surface = _tabular_surface(name)
    return inspected_target(
        kind="table" if name == "marimo-table" else "dataframe",
        family="tabular",
        component=name,
        component_metadata=_component_metadata(args),
        shape=value_shape,
        columns=value_columns,
        capability_flags={
            "columnar_dom": columnar_surface == "columnar-dom",
            "columnar_grid": columnar_surface == "columnar-grid",
            "interactive": True,
        },
        surfaces=(columnar_surface, "interactive"),
        summary=tabular_summary(entity.name, value, value_shape),
    )


def _data_explorer_target(
    entity: LensEntity,
    value: Any,
    name: str,
    args: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    value_columns = _component_columns(value, args)
    value_shape = _component_shape(value, args, value_columns)
    chart = {
        "library": "marimo-data-explorer",
        "renderer": "html",
        "parts": [
            {
                **chart_part("plot-area", "data explorer"),
                "library": "marimo-data-explorer",
            }
        ],
    }
    return inspected_target(
        kind="visualization",
        family="data-explorer",
        component=name,
        component_metadata=_component_metadata(args),
        shape=value_shape,
        columns=value_columns,
        chart=chart,
        capability_flags={
            "columnar_grid": bool(value_columns),
            "visual_surface": True,
            "chart_part": True,
            "interactive": True,
        },
        surfaces=(
            "chart-part",
            "columnar-grid" if value_columns else "",
            "visual-surface",
            "interactive",
        ),
        summary=visualization_summary(entity.name, value_columns),
    )


def _chart_target(
    entity: LensEntity,
    value: Any,
    name: str,
    args: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    value_columns = _component_columns(value, args)
    chart = _chart_metadata(name, args)
    return inspected_target(
        kind="visualization",
        family="chart",
        component=name,
        component_metadata=_component_metadata(args),
        shape=_component_shape(value, args, value_columns),
        columns=value_columns,
        chart=chart,
        capability_flags={
            "columnar_dom": bool(value_columns) and name == "marimo-vega",
            "visual_surface": True,
            "chart_part": True,
            "interactive": True,
        },
        surfaces=(
            "columnar-dom" if value_columns and name == "marimo-vega" else "",
            "chart-part",
            "visual-surface",
            "interactive",
        ),
        summary=visualization_summary(entity.name, value_columns),
    )


def _layout_target(
    entity: LensEntity,
    value: Any,
    name: str,
    args: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    return inspected_target(
        kind="layout",
        family="layout",
        component=name,
        component_metadata=_component_metadata(args),
        shape=shape(value),
        capability_flags={"interactive": True},
        surfaces=("interactive",),
        summary=control_summary(entity.name, value, name, args, label=label),
    )


_COMPONENT_HANDLERS = {
    "marimo-anywidget": _anywidget_target,
    "marimo-data-explorer": _data_explorer_target,
    **{name: _tabular_target for name in _TABULAR_COMPONENTS},
    **{name: _chart_target for name in _CHART_COMPONENTS},
    **{name: _layout_target for name in _LAYOUT_COMPONENTS},
}


def _component_columns(value: Any, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    for candidate in (
        _columns_from_component_args(args),
        columns(read_value(value)),
        columns(marimo_component(value).data),
        columns(value),
    ):
        if candidate:
            return candidate
    return _columns_from_chart_spec(args.get("spec"))


def _columns_from_component_args(args: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_columns = args.get("columns")
    if isinstance(raw_columns, Sequence) and not isinstance(
        raw_columns,
        (str, bytes, bytearray),
    ):
        return [
            _component_column(name=item[0], dtype=item[-1], index=index)
            if isinstance(item, Sequence)
            and not isinstance(item, (str, bytes, bytearray))
            and item
            else _component_column(name=item, dtype=None, index=index)
            for index, item in enumerate(raw_columns[:80])
        ]

    field_types = args.get("field-types")
    if isinstance(field_types, Sequence) and not isinstance(
        field_types,
        (str, bytes, bytearray),
    ):
        result: list[dict[str, Any]] = []
        for index, item in enumerate(field_types[:80]):
            if not isinstance(item, Sequence) or isinstance(
                item,
                (str, bytes, bytearray),
            ):
                result.append(_component_column(name=item, dtype=None, index=index))
                continue
            name = item[0] if item else index
            dtype = None
            if len(item) > 1:
                type_info = item[1]
                if isinstance(type_info, Sequence) and not isinstance(
                    type_info,
                    (str, bytes, bytearray),
                ):
                    dtype = type_info[-1] if type_info else None
                else:
                    dtype = type_info
            result.append(_component_column(name=name, dtype=dtype, index=index))
        return result

    return []


def _component_column(name: Any, dtype: Any, index: int) -> dict[str, Any]:
    return {
        "name": str(name if name not in {None, ""} else index),
        "dtype": str(dtype) if dtype is not None else None,
    }


def _tabular_surface(name: str) -> str:
    return _TABULAR_SURFACES.get(name, "columnar-dom")


def _component_shape(
    value: Any,
    args: Mapping[str, Any],
    value_columns: Sequence[Mapping[str, Any]],
) -> dict[str, int] | None:
    rows = _int_arg(args, "total-rows") or _int_arg(args, "total")
    cols = _int_arg(args, "total-columns") or (
        len(value_columns) if value_columns else None
    )
    if rows is not None and cols is not None:
        return {"rows": rows, "columns": cols}
    return (
        shape(read_value(value)) or shape(marimo_component(value).data) or shape(value)
    )


def _int_arg(args: Mapping[str, Any], key: str) -> int | None:
    value = args.get(key)
    if isinstance(value, int):
        return value
    return None


def _chart_metadata(name: str, args: Mapping[str, Any]) -> dict[str, Any]:
    config = _CHART_COMPONENT_CONFIG[name]
    if config["library"] == "vega":
        return _vega_chart_metadata(args.get("spec"))
    if config["library"] == "plotly" and isinstance(args.get("figure"), Mapping):
        metadata = plotly_chart_metadata_from_spec(
            args["figure"],
            renderer=str(config.get("renderer") or "html"),
        )
        metadata["extensions"] = _component_metadata(args)
        return metadata
    return _basic_chart_metadata(
        str(config["library"]),
        args,
        renderer=str(config.get("renderer") or "html"),
    )


def _vega_chart_metadata(spec: Any) -> dict[str, Any]:
    if not isinstance(spec, Mapping):
        return _basic_chart_metadata("vega", {})
    encoding = spec.get("encoding", {})
    parts = chart_spec_parts(spec)
    metadata: dict[str, Any] = {
        "library": "vega",
        "encoding": safe_value(encoding),
        "parts": with_chart_library("vega", dedupe_chart_parts(parts)),
    }
    if spec.get("mark") is not None:
        metadata["mark"] = safe_value(spec.get("mark"))
    return metadata


def _basic_chart_metadata(
    library: str,
    args: Mapping[str, Any],
    *,
    renderer: str = "html",
) -> dict[str, Any]:
    return {
        "library": library,
        "renderer": renderer,
        "parts": [{**chart_part("plot-area", library), "library": library}],
        "extensions": _component_metadata(args),
    }


def _columns_from_chart_spec(spec: Any) -> list[dict[str, Any]]:
    return chart_spec_fields(spec)


def _component_metadata(args: Mapping[str, Any]) -> dict[str, Any]:
    metadata = {
        key: value
        for key, value in args.items()
        if key
        not in {
            "data",
            "raw-data",
            "spec",
        }
    }
    return safe_value(metadata)
