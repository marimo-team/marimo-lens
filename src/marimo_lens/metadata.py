"""Value, widget, and target summarization helpers for Lens."""

from __future__ import annotations

import inspect
from collections.abc import Mapping, Sequence
from typing import Any

import anywidget
import traitlets

from ._marimo_runtime import (
    marimo_component,
    runtime_context as _runtime_context,
    runtime_globals as _runtime_globals,
)
from ._runtime_value_metadata import (
    control_summary as _control_summary,
    control_value as _control_value,
    safe_anywidget_state as _safe_anywidget_state,
    safe_trait_state as _safe_trait_state,
)
from ._serialization import (
    jsonable as _jsonable,
    safe_value as _safe_value,
)
from ._target_payload import (
    CAPABILITY_SELECTION_SURFACES,
    TARGET_KIND_PRIORITY,
    build_target_payload,
    css_attr as _css_attr,
    ordered_unique,
    python_type_name,
    target_extensions,
    target_family,
)
from .inspectors import (
    EntityRegistry,
    LensEntity,
    default_entity_registry,
    entity_kind,
)
from .selection import column as _selection_column
from .selection import unit as _selection_unit
from .selection import unsupported_cell as _unsupported_cell
from ._contract import (
    CAPABILITY_KEYS as _VALID_CAPABILITY_KEYS,
    CHART_PART_KINDS as _VALID_CHART_PART_KINDS,
    SELECTION_GRANULARITIES as _VALID_SELECTION_GRANULARITIES,
    SELECTION_SURFACES as _VALID_SELECTION_SURFACES,
    TARGET_CONTRACT_KEYS as _TARGET_CONTRACT_KEYS,
    TARGET_KINDS as _VALID_TARGET_KINDS,
)
from .inspectors._capabilities import target_capabilities as _target_capabilities

_INTERNAL_NAMES = {"mo", "app", "Lens", "target", "lens"}
_LENS_WIDGET_MARKER = "_marimo_lens_widget"
_CHART_PART_GRANULARITY_BY_KIND = {
    "axis": "group",
    "legend": "group",
    "mark": "item",
    "trace": "item",
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
        "pythonType": python_type_name(value),
        "cellIds": list(definitions.get(name, [])),
        "elementId": component.element_id,
        "label": label,
        "value": _control_value(value, component_name),
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
            "pythonType": python_type_name(widget),
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
            "pythonType": python_type_name(value),
            "cellIds": list(definitions.get(name, [])),
            "traits": sorted(traits.keys()),
            "state": traits,
            "summary": f"{name}: {type(value).__name__} with {len(traits)} traits",
        }
    )


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
        normalized.append(_jsonable(_normalize_target_contract(item)))
    return normalized


def _normalize_target_contract(item: dict[str, Any]) -> dict[str, Any]:
    item = dict(item)
    unknown = sorted(set(map(str, item.keys())) - set(_TARGET_CONTRACT_KEYS))
    if unknown:
        valid = ", ".join(_TARGET_CONTRACT_KEYS)
        raise ValueError(
            f"Lens target contains unknown keys: {', '.join(unknown)}. "
            f"Use extensions for custom metadata. Valid keys: {valid}"
        )
    kind = str(item["kind"])
    target_columns = _normalize_columns(item.get("columns") or ())
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
    if item.get("entity") is not None:
        item["entity"] = _normalize_entity_metadata(item["entity"], kind=kind)
    if item.get("output") is not None:
        item["output"] = _normalize_output_metadata(item["output"], item=item)
    item["selectionModel"] = _normalize_selection_model(
        item.get("selectionModel"),
        kind=kind,
        columns=target_columns,
        chart=item.get("chart"),
    )
    return item


def _normalize_entity_metadata(value: Any, *, kind: str) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("Lens target entity must be a mapping")
    inspector = str(value.get("inspector") or "")
    if not inspector:
        raise ValueError("Lens target entity requires inspector")
    entity: dict[str, str] = {
        "inspector": inspector,
        "family": str(value.get("family") or kind),
    }
    if value.get("source") is not None:
        entity["source"] = str(value["source"])
    return entity


def _normalize_output_metadata(value: Any, *, item: dict[str, Any]) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("Lens target output must be a mapping")
    allowed = {"cellId", "codePreview", "kind", "type"}
    output = {
        str(key): str(raw)
        for key, raw in value.items()
        if raw is not None and str(key) in allowed
    }
    unknown = {
        str(key): raw
        for key, raw in value.items()
        if raw is not None and str(key) not in allowed
    }
    if unknown:
        extensions = item.get("extensions")
        item["extensions"] = {
            **(dict(extensions) if isinstance(extensions, Mapping) else {}),
            "output": _safe_value(unknown),
        }
    return output


def _normalize_columns(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ValueError("Lens target columns must be a sequence")
    columns: list[dict[str, Any]] = []
    for index, raw_column in enumerate(value):
        to_dict = getattr(raw_column, "to_dict", None)
        column = to_dict() if callable(to_dict) else raw_column
        if not isinstance(column, Mapping):
            raise ValueError(f"Lens target column {index} must be a mapping")
        column = dict(column)
        name = str(column.get("name") or "")
        if not name:
            raise ValueError(f"Lens target column {index} requires name")
        item: dict[str, Any] = {"name": name}
        if column.get("dtype") is not None:
            item["dtype"] = str(column["dtype"])
        metadata = column.get("metadata")
        if isinstance(metadata, Mapping) and metadata:
            item["metadata"] = dict(metadata)
        columns.append(item)
    return columns


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
        key: bool(value[key]) if key in value else bool(defaults.get(key, False))
        for key in _VALID_CAPABILITY_KEYS
    }


def _normalize_selection_policy(
    value: Any,
    *,
    kind: str,
    capabilities: Mapping[str, bool],
) -> dict[str, Any]:
    policy = _parse_selection_policy(value, kind=kind, capabilities=capabilities)
    prefer = _augmented_selection_surfaces(
        policy["prefer"],
        kind=kind,
        capabilities=capabilities,
    )
    context = policy["context"]
    unknown = sorted(set(prefer) - set(_VALID_SELECTION_SURFACES))
    if unknown:
        valid = ", ".join(sorted(_VALID_SELECTION_SURFACES))
        raise ValueError(
            f"Lens target selectionPolicy.prefer contains unknown surfaces: "
            f"{', '.join(unknown)}. Valid surfaces: {valid}"
        )
    return {"prefer": ordered_unique(prefer), "context": dict(context)}


def _parse_selection_policy(
    value: Any,
    *,
    kind: str,
    capabilities: Mapping[str, bool],
) -> dict[str, Any]:
    if value is None:
        return {
            "prefer": _default_selection_surfaces(kind, capabilities),
            "context": {},
        }
    if not isinstance(value, Mapping):
        raise ValueError("Lens target selectionPolicy must be a mapping")
    raw_prefer = value.get("prefer")
    prefer = (
        _default_selection_surfaces(kind, capabilities)
        if raw_prefer is None
        else _string_sequence(raw_prefer, "Lens target selectionPolicy.prefer")
    )
    raw_context = value.get("context") or {}
    if not isinstance(raw_context, Mapping):
        raise ValueError("Lens target selectionPolicy.context must be a mapping")
    return {"prefer": prefer, "context": dict(raw_context)}


def _augmented_selection_surfaces(
    prefer: Sequence[str],
    *,
    kind: str,
    capabilities: Mapping[str, bool],
) -> list[str]:
    surfaces = list(prefer)
    if capabilities.get("interactive"):
        surfaces.append("interactive")
    if kind == "output":
        surfaces = _with_before_selector(surfaces, "display-cell")
    surfaces.append("selector")
    return surfaces


def _default_selection_surfaces(
    kind: str,
    capabilities: Mapping[str, bool],
) -> list[str]:
    surfaces = [
        surface
        for capability, surface in CAPABILITY_SELECTION_SURFACES
        if capabilities.get(capability)
    ]
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
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        value = to_dict()
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
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        value = to_dict()
    if not isinstance(value, Mapping):
        raise ValueError(f"Lens target selectionModel unit {index} must be a mapping")
    kind = str(value.get("kind") or "")
    if not kind:
        raise ValueError(f"Lens target selectionModel unit {index} requires kind")
    data = _mapping_or_empty(
        value.get("data"),
        f"Lens target selectionModel unit {index}.data",
    )
    raw_match = value.get("match")
    match = _mapping_or_empty(
        raw_match,
        f"Lens target selectionModel unit {index}.match",
    )
    unit = {
        "kind": kind,
        "id": str(value.get("id") or kind),
        "label": str(value.get("label") or kind),
        "requires": _string_sequence(
            value.get("requires") or (),
            f"Lens target selectionModel unit {index}.requires",
        ),
        "selectors": _string_sequence(
            value.get("selectors") or (),
            f"Lens target selectionModel unit {index}.selectors",
        ),
        "fallbackFor": _string_sequence(
            value.get("fallbackFor") or (),
            f"Lens target selectionModel unit {index}.fallbackFor",
        ),
        "supported": bool(value.get("supported", True)),
        "match": dict(match),
        "data": data,
    }
    granularity = _selection_granularity(
        value.get("granularity"),
        f"Lens target selectionModel unit {index}.granularity",
    )
    if granularity is not None:
        unit["granularity"] = granularity
    if value.get("parentId"):
        unit["parentId"] = str(value["parentId"])
    if raw_match is None:
        unit["match"] = _inferred_unit_match(unit)
    priority = value.get("priority")
    if priority is not None:
        if not isinstance(priority, int):
            raise ValueError(
                f"Lens target selectionModel unit {index}.priority must be an int"
            )
        unit["priority"] = priority
    return unit


def _string_sequence(value: Any, label: str) -> list[str]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ValueError(f"{label} must be a sequence")
    return [str(item) for item in value if str(item)]


def _mapping_or_empty(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be a mapping")
    return dict(value)


def _selection_granularity(value: Any, label: str) -> str | None:
    if value is None:
        return None
    granularity = str(value)
    if granularity in _VALID_SELECTION_GRANULARITIES:
        return granularity
    valid = ", ".join(sorted(_VALID_SELECTION_GRANULARITIES))
    raise ValueError(f"{label} must be one of: {valid}")


def _inferred_unit_match(unit: Mapping[str, Any]) -> dict[str, Any]:
    """Infer resolver hints from common unit payloads when omitted."""

    data = unit.get("data") or {}
    if not isinstance(data, Mapping):
        return {}
    match: dict[str, Any] = {}
    if data.get("column") is not None:
        match["column"] = data["column"]
    chart_part = data.get("chartPart")
    if isinstance(chart_part, Mapping):
        match.update(_chart_part_match(chart_part))
    return match


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
        dtype = column.get("dtype")
        units.append(
            _selection_column(name, dtype=str(dtype) if dtype else None).to_dict()
        )
    if columns:
        units.append(_unsupported_cell().to_dict())

    chart_part_units = _default_chart_part_selection_units(chart)
    units.extend(chart_part_units)
    if not units:
        units.append(
            _selection_unit(
                "target",
                id=f"target:{kind}",
                label=kind,
                granularity="target",
                fallback_for=("surface",),
            ).to_dict()
        )
    return {
        "units": units,
        "defaultFallback": "column"
        if columns
        else ("mark" if chart_part_units else "target"),
    }


def _default_chart_part_selection_units(
    chart: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(chart, Mapping):
        return []
    units: list[dict[str, Any]] = []
    for index, part in enumerate(chart.get("parts") or []):
        if not isinstance(part, Mapping):
            continue
        part_kind = str(part.get("kind") or "")
        label = str(part.get("label") or part_kind or f"chart part {index + 1}")
        if not part_kind:
            continue
        units.append(
            _selection_unit(
                part_kind,
                id=str(part.get("id") or f"chart:{part_kind}:{index}"),
                label=label,
                granularity=_chart_part_granularity(part_kind, part),
                selectors=(str(part["selector"]),) if part.get("selector") else (),
                match=_chart_part_match(part),
                data={"chartPart": dict(part)},
            ).to_dict()
        )
    return units


def _chart_part_granularity(
    part_kind: str,
    part: Mapping[str, Any],
) -> str:
    if part.get("datum"):
        return "datum"
    return _CHART_PART_GRANULARITY_BY_KIND.get(part_kind, "surface")


def _chart_part_match(part: Mapping[str, Any]) -> dict[str, Any]:
    match: dict[str, Any] = {"chartKind": str(part.get("kind") or "")}
    for key in ("channel", "field", "id", "label", "library", "orientation"):
        value = part.get(key)
        if value is not None:
            match[key] = value
    return match


def _normalize_chart_metadata(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("Lens target chart metadata must be a mapping")
    chart = {str(key): item for key, item in value.items() if item is not None}
    _move_unknown_keys_to_extensions(
        chart,
        {
            "axesCount",
            "encoding",
            "extensions",
            "library",
            "mark",
            "parts",
            "renderer",
            "traceCount",
        },
    )
    parts = chart.get("parts") or []
    if isinstance(parts, str) or not isinstance(parts, Sequence):
        raise ValueError("Lens target chart.parts must be a sequence")
    normalized_parts: list[dict[str, Any]] = []
    for index, raw_part in enumerate(parts):
        if not isinstance(raw_part, Mapping):
            raise ValueError(f"Lens target chart part {index} must be a mapping")
        part = {str(key): item for key, item in raw_part.items() if item is not None}
        _move_unknown_keys_to_extensions(
            part,
            {
                "channel",
                "context",
                "datum",
                "detail",
                "extensions",
                "field",
                "id",
                "kind",
                "label",
                "library",
                "orientation",
                "selector",
            },
        )
        kind = str(part.get("kind") or "")
        if kind not in _VALID_CHART_PART_KINDS:
            valid = ", ".join(sorted(_VALID_CHART_PART_KINDS))
            raise ValueError(f"Lens target chart part kind must be one of: {valid}")
        if not str(part.get("label") or ""):
            raise ValueError("Lens target chart part requires label")
        normalized_parts.append(part)
    chart["parts"] = normalized_parts
    return chart


def _move_unknown_keys_to_extensions(item: dict[str, Any], allowed: set[str]) -> None:
    unknown = {key: item.pop(key) for key in sorted(set(item) - allowed)}
    if not unknown:
        return
    extensions = item.get("extensions")
    item["extensions"] = {
        **(dict(extensions) if isinstance(extensions, Mapping) else {}),
        **unknown,
    }


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

    return _jsonable(
        build_target_payload(
            id=target_id,
            variable=name,
            label=str(inspected.get("label") or name),
            kind=kind,
            cell_id=cell_id,
            display_cell_ids=display_ids,
            related_cell_ids=related_ids,
            defs=cell.get("defs", []) if cell else [name],
            refs=cell.get("refs", []) if cell else [],
            shape=shape,
            columns=columns,
            chart=chart,
            capabilities=capabilities,
            summary=str(inspected.get("summary") or f"{name}: {type(value).__name__}"),
            selectors=selectors,
            python_type=python_type_name(value),
            component=_optional_string(inspected.get("component")),
            entity={
                "inspector": inspection.inspector_id,
                "family": target_family(inspected, kind),
            },
            output=_optional_mapping(inspected.get("output")),
            output_refs=[str(ref) for ref in inspected.get("outputRefs") or []],
            output_type=_optional_string(inspected.get("outputType")),
            code_preview=_optional_string(inspected.get("codePreview")),
            selection_model=_optional_mapping(inspected.get("selectionModel")),
            selection_policy=_optional_mapping(inspected.get("selectionPolicy")),
            extensions=target_extensions(inspected),
        )
    )


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
        or _is_single_ref_output_expression(name, cell)
    ]
    return list(dict.fromkeys(ids))


def _is_single_ref_output_expression(name: str, cell: Mapping[str, Any]) -> bool:
    if not bool(cell.get("hasOutputExpression", False)):
        return False
    if cell.get("defs"):
        return False
    refs = [str(ref) for ref in cell.get("refs") or []]
    return refs == [name]


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
        priority = TARGET_KIND_PRIORITY.get(kind, 12)
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
            "pythonType": python_type_name(value),
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


def _optional_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


def _optional_string(value: Any) -> str | None:
    return str(value) if value is not None else None


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
