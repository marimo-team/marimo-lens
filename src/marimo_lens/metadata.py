"""Value, widget, and target summarization helpers for Lens."""

from __future__ import annotations

import inspect
from collections.abc import Mapping, Sequence
from typing import Any

import anywidget
import traitlets

from ._marimo_runtime import (
    anywidget_state as _anywidget_state,
    marimo_component,
    runtime_context as _runtime_context,
    runtime_globals as _runtime_globals,
)
from ._serialization import (
    MAX_VALUE_ITEMS as _MAX_VALUE_ITEMS,
    jsonable as _jsonable,
    preview as _preview,
    safe_value as _safe_value,
)
from .inspectors import (
    EntityRegistry,
    LensEntity,
    default_entity_registry,
    entity_kind,
)
from .inspectors._capabilities import target_capabilities as _target_capabilities

_INTERNAL_NAMES = {"mo", "app", "Lens", "target", "lens"}
_LENS_WIDGET_MARKER = "_marimo_lens_widget"
_VALID_TARGET_KINDS = {
    "anywidget",
    "data",
    "dataframe",
    "diagnostic",
    "document",
    "layout",
    "media",
    "object",
    "output",
    "table",
    "ui",
    "visualization",
}
_VALID_CAPABILITY_KEYS = (
    "columnarDom",
    "columnarGrid",
    "data",
    "diagnostic",
    "document",
    "interactive",
    "chartPart",
    "media",
    "visualSurface",
)
_VALID_SELECTION_SURFACES = {
    "chart-unit",
    "columnar-dom",
    "columnar-grid",
    "display-cell",
    "document",
    "interactive",
    "marked",
    "media",
    "selector",
    "visual-surface",
}
_VALID_CHART_PART_KINDS = {
    "annotation",
    "axis",
    "legend",
    "mark",
    "plot-area",
    "title",
    "trace",
}


def _summarize_ui_element(
    name: str,
    value: Any,
    definitions: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    component = marimo_component(value)
    component_name = component.name
    component_args = dict(component.args)
    lens = getattr(value, "_lens", None)
    widget = component.widget
    label = component.label
    summary = {
        "name": name,
        "kind": "anywidget" if widget is not None else "ui",
        "component": component_name,
        "pythonType": type(value).__module__ + "." + type(value).__qualname__,
        "cellIds": list(definitions.get(name, [])),
        "elementId": component.element_id,
        "label": label,
        "value": _control_value(value, component_name, component_args, name, label),
        "initialValue": _safe_value(getattr(value, "_initial_value", None)),
        "frontendValue": _safe_value(getattr(value, "_value_frontend", None)),
        "args": _safe_value(component_args),
        "lens": {
            "parentId": str(getattr(lens, "parent_id", "") or ""),
            "key": str(getattr(lens, "key", "") or ""),
        }
        if lens is not None
        else None,
        "summary": _control_summary(
            name,
            value,
            component_name,
            component_args,
            label=label,
        ),
    }
    if widget is not None and not _is_lens_widget(widget):
        summary["widget"] = _summarize_anywidget(f"{name}.widget", widget, {})
    return _jsonable(summary)


def _summarize_anywidget(
    name: str,
    widget: anywidget.AnyWidget,
    definitions: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    state = _safe_anywidget_state(widget)
    return _jsonable(
        {
            "name": name,
            "kind": "anywidget",
            "pythonType": type(widget).__module__ + "." + type(widget).__qualname__,
            "cellIds": list(definitions.get(name, [])),
            "modelId": str(getattr(widget, "_model_id", "") or ""),
            "traits": sorted(state.keys()),
            "state": state,
            "summary": f"{name}: {type(widget).__name__} with {len(state)} synced traits",
        }
    )


def _summarize_traitlets_object(
    name: str,
    value: traitlets.HasTraits,
    definitions: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    traits = _safe_trait_state(value)
    return _jsonable(
        {
            "name": name,
            "kind": "traitlets",
            "pythonType": type(value).__module__ + "." + type(value).__qualname__,
            "cellIds": list(definitions.get(name, [])),
            "traits": sorted(traits.keys()),
            "state": traits,
            "summary": f"{name}: {type(value).__name__} with {len(traits)} traits",
        }
    )


def _control_value(
    value: Any,
    component_name: str,
    component_args: Mapping[str, Any],
    name: str = "",
    label: str = "",
) -> Any:
    _ = (component_args, name, label)
    if "file" in component_name:
        return _summarize_file_value(_read_value(value))
    return _safe_value(_read_value(value))


def _read_value(value: Any) -> Any:
    try:
        return getattr(value, "value")
    except Exception as exc:
        return {"unavailable": f"{type(exc).__name__}: {exc}"}


def _summarize_file_value(value: Any) -> Any:
    if value is None:
        return None
    files = value if isinstance(value, list) else [value]
    result = []
    for item in files[:_MAX_VALUE_ITEMS]:
        result.append(
            {
                "name": _safe_value(getattr(item, "name", None)),
                "size": _safe_value(getattr(item, "size", None)),
                "type": _safe_value(getattr(item, "type", None)),
            }
            if not isinstance(item, Mapping)
            else {
                "name": _safe_value(item.get("name")),
                "size": _safe_value(item.get("size")),
                "type": _safe_value(item.get("type")),
            }
        )
    return result


def _safe_anywidget_state(widget: anywidget.AnyWidget) -> dict[str, Any]:
    try:
        state = _anywidget_state(widget)
    except Exception as exc:
        return {"unavailable": f"{type(exc).__name__}: {exc}"}
    result: dict[str, Any] = {}
    for key, value in state.items():
        if _is_private_or_system_trait(key):
            continue
        result[str(key)] = _safe_value(value, key=key)
        if len(result) >= _MAX_VALUE_ITEMS:
            break
    return result


def _safe_trait_state(value: traitlets.HasTraits) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in sorted(value.traits().keys()):
        if _is_private_or_system_trait(key):
            continue
        try:
            result[key] = _safe_value(getattr(value, key), key=key)
        except Exception as exc:
            result[key] = {"unavailable": f"{type(exc).__name__}: {exc}"}
        if len(result) >= _MAX_VALUE_ITEMS:
            break
    return result


def _is_private_or_system_trait(name: str) -> bool:
    return name.startswith("_") or name in {
        "comm",
        "layout",
        "log",
        "style",
        "keys",
        "tabbable",
        "tooltip",
    }


def _control_summary(
    name: str,
    value: Any,
    component_name: str,
    component_args: Mapping[str, Any],
    label: str = "",
) -> str:
    current_value = _control_value(value, component_name, component_args, name, label)
    if isinstance(current_value, Mapping) and "unavailable" in current_value:
        return f"{name}: {component_name or type(value).__name__} value unavailable"
    return f"{name}: {component_name or type(value).__name__} = {_preview(repr(current_value), 120)}"


def _is_lens_widget(value: Any) -> bool:
    return bool(getattr(value, _LENS_WIDGET_MARKER, False))


def _normalize_targets(
    targets: Sequence[Any] | None,
) -> list[dict[str, Any]]:
    if not targets:
        return []
    normalized: list[dict[str, Any]] = []
    for raw in targets:
        to_dict = getattr(raw, "to_dict", None)
        item = dict(to_dict() if callable(to_dict) else raw)
        missing = [
            key for key in ("id", "label", "kind") if not str(item.get(key) or "")
        ]
        if missing:
            fields = ", ".join(missing)
            raise ValueError(f"Lens manual targets require: {fields}")
        kind = str(item["kind"])
        if kind not in _VALID_TARGET_KINDS:
            valid = ", ".join(sorted(_VALID_TARGET_KINDS))
            raise ValueError(f"Lens manual target kind must be one of: {valid}")
        normalized.append(_normalize_target_contract(item))
    return normalized


def _normalize_target_contract(item: dict[str, Any]) -> dict[str, Any]:
    kind = str(item["kind"])
    target_columns = list(item.get("columns") or [])
    capabilities = _normalize_capabilities(
        item.get("capabilities"),
        kind=kind,
        columns=target_columns,
    )
    item["columns"] = target_columns
    item["capabilities"] = capabilities
    item["selectionPolicy"] = _normalize_selection_policy(
        item.get("selectionPolicy"),
        kind=kind,
        capabilities=capabilities,
    )
    chart = item.get("chart")
    if chart is not None:
        item["chart"] = _normalize_chart_metadata(chart)
    item["selectionModel"] = _normalize_selection_model(
        item.get("selectionModel"),
        kind=kind,
        columns=target_columns,
        chart=item.get("chart"),
    )
    return item


def _normalize_capabilities(
    value: Any,
    *,
    kind: str,
    columns: Sequence[Mapping[str, Any]],
) -> dict[str, bool]:
    defaults = _target_capabilities(kind, columns)
    if value is None:
        return defaults
    if not isinstance(value, Mapping):
        raise ValueError("Lens target capabilities must be a mapping")
    unknown = sorted(set(map(str, value.keys())) - set(_VALID_CAPABILITY_KEYS))
    if unknown:
        valid = ", ".join(_VALID_CAPABILITY_KEYS)
        raise ValueError(
            f"Lens target capabilities contain unknown keys: {', '.join(unknown)}. "
            f"Valid keys: {valid}"
        )
    return {
        key: bool(value.get(key, defaults.get(key, False)))
        for key in _VALID_CAPABILITY_KEYS
    }


def _normalize_selection_policy(
    value: Any,
    *,
    kind: str,
    capabilities: Mapping[str, bool],
) -> dict[str, Any]:
    if value is None:
        prefer = _default_selection_surfaces(kind, capabilities)
        context: Mapping[str, Any] = {}
    else:
        if not isinstance(value, Mapping):
            raise ValueError("Lens target selectionPolicy must be a mapping")
        raw_prefer = value.get("prefer")
        if raw_prefer is None:
            prefer = _default_selection_surfaces(kind, capabilities)
        else:
            if isinstance(raw_prefer, str) or not isinstance(raw_prefer, Sequence):
                raise ValueError(
                    "Lens target selectionPolicy.prefer must be a sequence"
                )
            prefer = [str(surface) for surface in raw_prefer if str(surface)]
        raw_context = value.get("context") or {}
        if not isinstance(raw_context, Mapping):
            raise ValueError("Lens target selectionPolicy.context must be a mapping")
        context = raw_context
    unknown = sorted(set(prefer) - _VALID_SELECTION_SURFACES)
    if unknown:
        valid = ", ".join(sorted(_VALID_SELECTION_SURFACES))
        raise ValueError(
            f"Lens target selectionPolicy.prefer contains unknown surfaces: "
            f"{', '.join(unknown)}. Valid surfaces: {valid}"
        )
    if capabilities.get("interactive") and "interactive" not in prefer:
        prefer.append("interactive")
    if kind == "output":
        prefer = _with_before_selector(prefer, "display-cell")
    prefer.append("selector")
    return {"prefer": list(dict.fromkeys(prefer)), "context": dict(context)}


def _default_selection_surfaces(
    kind: str,
    capabilities: Mapping[str, bool],
) -> list[str]:
    surfaces: list[str] = []
    if capabilities.get("columnarGrid"):
        surfaces.append("columnar-grid")
    if capabilities.get("columnarDom"):
        surfaces.append("columnar-dom")
    if capabilities.get("chartPart"):
        surfaces.append("chart-unit")
    if capabilities.get("visualSurface"):
        surfaces.append("visual-surface")
    if capabilities.get("media"):
        surfaces.append("media")
    if capabilities.get("document"):
        surfaces.append("document")
    if capabilities.get("interactive"):
        surfaces.append("interactive")
    if kind == "output":
        surfaces.append("display-cell")
    return surfaces


def _with_before_selector(prefer: list[str], surface: str) -> list[str]:
    if surface in prefer:
        return prefer
    try:
        selector_index = prefer.index("selector")
    except ValueError:
        return [*prefer, surface]
    return [*prefer[:selector_index], surface, *prefer[selector_index:]]


def _normalize_selection_model(
    value: Any,
    *,
    kind: str,
    columns: Sequence[Mapping[str, Any]],
    chart: Mapping[str, Any] | None,
) -> dict[str, Any]:
    default = _default_selection_model(kind=kind, columns=columns, chart=chart)
    if value is None:
        return default
    if not isinstance(value, Mapping):
        raise ValueError("Lens target selectionModel must be a mapping")
    raw_units = value.get("units", default["units"])
    if isinstance(raw_units, str) or not isinstance(raw_units, Sequence):
        raise ValueError("Lens target selectionModel.units must be a sequence")
    units = [
        _normalize_selection_model_unit(unit, index)
        for index, unit in enumerate(raw_units)
    ]
    fallback = str(value.get("defaultFallback") or default.get("defaultFallback") or "")
    return {
        "units": units,
        "defaultFallback": fallback,
    }


def _normalize_selection_model_unit(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"Lens target selectionModel unit {index} must be a mapping")
    unit = dict(value)
    kind = str(unit.get("kind") or "")
    if not kind:
        raise ValueError(f"Lens target selectionModel unit {index} requires kind")
    unit["kind"] = kind
    unit["id"] = str(unit.get("id") or kind)
    unit["label"] = str(unit.get("label") or kind)
    for key in ("requires", "selectors", "fallbackFor"):
        raw = unit.get(key) or []
        if isinstance(raw, str) or not isinstance(raw, Sequence):
            raise ValueError(
                f"Lens target selectionModel unit {index}.{key} must be a sequence"
            )
        unit[key] = [str(item) for item in raw if str(item)]
    unit["supported"] = bool(unit.get("supported", True))
    data = unit.get("data") or {}
    if not isinstance(data, Mapping):
        raise ValueError(
            f"Lens target selectionModel unit {index}.data must be a mapping"
        )
    unit["data"] = dict(data)
    return unit


def _default_selection_model(
    *,
    kind: str,
    columns: Sequence[Mapping[str, Any]],
    chart: Mapping[str, Any] | None,
) -> dict[str, Any]:
    units: list[dict[str, Any]] = []
    for column in columns:
        name = str(column.get("name") or "")
        if not name:
            continue
        data = {"column": name}
        dtype = column.get("dtype")
        if dtype is not None:
            data["columnDtype"] = str(dtype)
        units.append(
            {
                "kind": "column",
                "id": f"col:{name}",
                "label": name,
                "selectors": [],
                "fallbackFor": [
                    "cell",
                    "summary-stat",
                    "dtype-label",
                    "body-cell",
                    "grid-cell",
                ],
                "requires": [],
                "supported": True,
                "data": data,
            }
        )
    if columns:
        units.append(
            {
                "kind": "cell",
                "id": "cell",
                "label": "cell",
                "requires": ["rowId", "column"],
                "selectors": [],
                "fallbackFor": [],
                "supported": False,
                "data": {},
            }
        )

    chart_units = _default_chart_selection_units(chart)
    units.extend(chart_units)
    if not units:
        units.append(
            {
                "kind": "target",
                "id": f"target:{kind}",
                "label": kind,
                "requires": [],
                "selectors": [],
                "fallbackFor": ["surface"],
                "supported": True,
                "data": {},
            }
        )
    return {
        "units": units,
        "defaultFallback": "column"
        if columns
        else ("mark" if chart_units else "target"),
    }


def _default_chart_selection_units(
    chart: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(chart, Mapping):
        return []
    units: list[dict[str, Any]] = []
    for index, part in enumerate(chart.get("parts") or []):
        if not isinstance(part, Mapping):
            continue
        part_kind = str(part.get("kind") or "")
        label = str(part.get("label") or part_kind or f"chart unit {index + 1}")
        if not part_kind:
            continue
        units.append(
            {
                "kind": part_kind,
                "id": str(part.get("id") or f"chart:{part_kind}:{index}"),
                "label": label,
                "requires": [],
                "selectors": [str(part["selector"])] if part.get("selector") else [],
                "fallbackFor": [],
                "supported": True,
                "data": {"chartPart": dict(part)},
            }
        )
    return units


def _normalize_chart_metadata(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("Lens target chart metadata must be a mapping")
    chart = dict(value)
    parts = chart.get("parts") or []
    if isinstance(parts, str) or not isinstance(parts, Sequence):
        raise ValueError("Lens target chart.parts must be a sequence")
    normalized_parts: list[dict[str, Any]] = []
    for index, raw_part in enumerate(parts):
        if not isinstance(raw_part, Mapping):
            raise ValueError(f"Lens target chart unit {index} must be a mapping")
        part = dict(raw_part)
        kind = str(part.get("kind") or "")
        if kind not in _VALID_CHART_PART_KINDS:
            valid = ", ".join(sorted(_VALID_CHART_PART_KINDS))
            raise ValueError(f"Lens target chart unit kind must be one of: {valid}")
        normalized_parts.append(part)
    chart["parts"] = normalized_parts
    return chart


def _caller_namespace(skip: int = 2) -> dict[str, Any]:
    frame = inspect.currentframe()
    for _ in range(skip):
        frame = frame.f_back if frame is not None else None

    ctx, _reason = _runtime_context()
    namespace = _runtime_globals(ctx)
    if frame is None:
        return namespace

    namespace.update(frame.f_globals)
    namespace.update(frame.f_locals)
    return namespace


def _infer_variable_name(value: Any) -> str | None:
    namespace = _caller_namespace(skip=3)
    for name, candidate in namespace.items():
        if _is_internal_value(name, candidate):
            continue
        try:
            if candidate is value:
                return name
        except Exception:
            continue
    return None


def _summarize_target(
    name: str,
    value: Any,
    graph: Mapping[str, Any],
    *,
    entity_registry: EntityRegistry | None = None,
) -> dict[str, Any] | None:
    definition_ids = list(graph.get("definitions", {}).get(name, []))
    cell_id = definition_ids[0] if definition_ids else None
    related_ids = _related_cell_ids(name, cell_id, graph)
    display_ids = _display_cell_ids(name, cell_id, graph)
    cell = _cell_by_id(cell_id, graph) if cell_id else None
    entity = LensEntity(
        name=name,
        value=value,
        graph=graph,
        cell_id=cell_id,
        display_cell_ids=display_ids,
        related_cell_ids=related_ids,
        cell=cell,
    )
    inspection = (entity_registry or default_entity_registry()).inspect(entity)
    if inspection is None:
        return None
    inspected = dict(inspection.metadata)
    kind = str(inspected.get("kind") or "object")
    columns = list(inspected.get("columns") or [])
    shape = inspected.get("shape")
    chart = inspected.get("chart")
    capabilities = dict(
        inspected.get("capabilities") or _target_capabilities(kind, columns)
    )
    target_id = f"var:{name}"
    selectors = [f'[data-marimo-lens-var="{_css_attr(name)}"]']
    selectors.extend(f'[id="output-{cell_id}"]' for cell_id in display_ids)
    selectors.extend(str(selector) for selector in inspected.get("selectors") or [])

    target = {
        key: item
        for key, item in inspected.items()
        if key
        not in {
            "capabilities",
            "cellId",
            "chart",
            "columns",
            "defs",
            "displayCellIds",
            "id",
            "kind",
            "label",
            "pythonType",
            "refs",
            "relatedCellIds",
            "selectors",
            "shape",
            "summary",
            "variable",
        }
    }
    target.update(
        {
            "id": target_id,
            "variable": name,
            "label": str(inspected.get("label") or name),
            "kind": kind,
            "cellId": cell_id,
            "displayCellIds": display_ids,
            "relatedCellIds": related_ids,
            "defs": cell.get("defs", []) if cell else [name],
            "refs": cell.get("refs", []) if cell else [],
            "shape": shape,
            "columns": columns,
            "chart": chart,
            "capabilities": capabilities,
            "summary": inspected.get("summary") or f"{name}: {type(value).__name__}",
            "selectors": list(dict.fromkeys(selectors)),
            "pythonType": type(value).__module__ + "." + type(value).__qualname__,
            "entity": {
                "inspector": inspection.inspector_id,
                "family": inspected.get("family") or kind,
            },
        }
    )
    return _jsonable(target)


def _display_cell_ids(
    name: str,
    cell_id: str | None,
    graph: Mapping[str, Any],
) -> list[str]:
    del cell_id
    ids = [
        str(cell["id"])
        for cell in graph.get("cells", [])
        if name in cell.get("outputRefs", [])
    ]
    return list(dict.fromkeys(ids))


def _related_cell_ids(
    name: str,
    cell_id: str | None,
    graph: Mapping[str, Any],
) -> list[str]:
    ids = [
        str(cell["id"])
        for cell in graph.get("cells", [])
        if str(cell.get("id")) != str(cell_id) and name in cell.get("refs", [])
    ]
    return list(dict.fromkeys(ids))


def _cell_by_id(cell_id: str | None, graph: Mapping[str, Any]) -> dict[str, Any] | None:
    if cell_id is None:
        return None
    for cell in graph.get("cells", []):
        if str(cell.get("id")) == cell_id:
            return dict(cell)
    return None


def _auto_include(
    namespace: Mapping[str, Any],
    *,
    graph: Mapping[str, Any],
    entity_registry: EntityRegistry | None = None,
) -> list[str]:
    registry = entity_registry or default_entity_registry()
    definitions = graph.get("definitions", {})
    ordered_names = [*definitions.keys(), *namespace.keys()]
    names: list[tuple[int, int, str]] = []
    seen: set[str] = set()
    for raw_name in ordered_names:
        name = str(raw_name)
        if name in seen or name not in namespace:
            continue
        seen.add(name)
        value = namespace[name]
        if _is_internal_value(name, value):
            continue
        entity = LensEntity(
            name=name,
            value=value,
            graph=graph,
            cell_id=None,
            display_cell_ids=(),
            related_cell_ids=(),
        )
        inspection = registry.inspect(entity)
        if inspection is None:
            continue
        kind = str(inspection.metadata.get("kind") or "object")
        if kind == "object":
            continue
        defined_in_graph = 0 if name in definitions else 1
        priority = {
            "dataframe": 0,
            "table": 1,
            "visualization": 2,
            "data": 3,
            "document": 4,
            "media": 5,
            "layout": 6,
            "diagnostic": 7,
            "anywidget": 8,
            "ui": 9,
            "object": 10,
        }.get(kind, 12)
        names.append((defined_in_graph, priority, name))
    return [name for _, _, name in sorted(names)]


def _summarize_namespace(
    namespace: Mapping[str, Any],
    *,
    definitions: Mapping[str, Sequence[str]] | None = None,
    entity_registry: EntityRegistry | None = None,
) -> list[dict[str, Any]]:
    definitions = definitions or {}
    summaries: list[dict[str, Any]] = []
    for name, value in namespace.items():
        if _is_internal_value(name, value):
            continue
        summary = _global_summary(
            name,
            value,
            definitions,
            entity_registry=entity_registry,
        )
        if summary is not None:
            summaries.append(summary)
    return sorted(
        summaries, key=lambda item: (str(item.get("kind")), str(item.get("name")))
    )


def _global_summary(
    name: str,
    value: Any,
    definitions: Mapping[str, Sequence[str]],
    *,
    entity_registry: EntityRegistry | None = None,
) -> dict[str, Any] | None:
    entity = LensEntity(
        name=name,
        value=value,
        graph={"definitions": definitions},
        cell_id=None,
        display_cell_ids=(),
        related_cell_ids=(),
    )
    inspection = (entity_registry or default_entity_registry()).inspect(entity)
    if inspection is None:
        return None
    inspected = dict(inspection.metadata)
    kind = str(inspected.get("kind") or "object")
    shape = inspected.get("shape")
    columns = list(inspected.get("columns") or [])
    chart = inspected.get("chart")
    definition_ids = list(definitions.get(name, []))
    return _jsonable(
        {
            "name": name,
            "kind": kind,
            "pythonType": type(value).__module__ + "." + type(value).__qualname__,
            "cellIds": definition_ids,
            "shape": shape,
            "columns": columns[:20],
            "chart": chart,
            "summary": inspected.get("summary") or f"{name}: {type(value).__name__}",
            "entity": {
                "inspector": inspection.inspector_id,
                "family": inspected.get("family") or kind,
            },
        }
    )


def _is_internal_name(name: str) -> bool:
    return name.startswith("_") or name in _INTERNAL_NAMES


def _is_internal_value(name: str, value: Any) -> bool:
    if _is_internal_name(name):
        return True
    if inspect.ismodule(value) or inspect.isfunction(value) or inspect.isclass(value):
        return True
    if _is_lens_widget(value):
        return True
    return False


def _infer_kind(value: Any) -> str:
    return entity_kind(value)


def _css_attr(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')
