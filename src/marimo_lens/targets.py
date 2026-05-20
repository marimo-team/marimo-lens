"""Public target helpers and namespace target collection."""

from __future__ import annotations

import html
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias

from ._marimo_runtime import runtime_context as _runtime_context
from .inspectors import EntityRegistry
from .metadata import (
    _auto_include,
    _caller_namespace,
    _css_attr,
    _infer_kind,
    _infer_variable_name,
    _is_internal_name,
    _is_lens_widget,
    _is_internal_value,
    _summarize_target,
)
from .selection import Model as SelectionModel
from .selection import Policy as SelectionPolicy

TargetKind: TypeAlias = Literal[
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
]


@dataclass(frozen=True)
class Column:
    """Column metadata exposed by columnar Lens targets."""

    name: str
    dtype: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"name": self.name}
        if self.dtype is not None:
            item["dtype"] = self.dtype
        item.update(dict(self.metadata))
        return item


@dataclass(frozen=True)
class Shape:
    """Tabular or visual extent exposed by a target."""

    rows: int | None = None
    columns: int | None = None

    def to_dict(self) -> dict[str, int]:
        item: dict[str, int] = {}
        if self.rows is not None:
            item["rows"] = self.rows
        if self.columns is not None:
            item["columns"] = self.columns
        return item


@dataclass(frozen=True)
class Capabilities:
    """Behavioral capabilities used by frontend selection plugins."""

    columnar_dom: bool = False
    columnar_grid: bool = False
    data: bool = False
    diagnostic: bool = False
    document: bool = False
    interactive: bool = False
    chart_part: bool = False
    media: bool = False
    visual_surface: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "columnarDom": self.columnar_dom,
            "columnarGrid": self.columnar_grid,
            "data": self.data,
            "diagnostic": self.diagnostic,
            "document": self.document,
            "interactive": self.interactive,
            "chartPart": self.chart_part,
            "media": self.media,
            "visualSurface": self.visual_surface,
        }


@dataclass(frozen=True)
class TargetMetadata:
    """Canonical Python target metadata before wire normalization."""

    id: str
    label: str
    kind: TargetKind | str
    variable: str | None = None
    cell_id: str | None = None
    display_cell_ids: Sequence[str] = ()
    related_cell_ids: Sequence[str] = ()
    defs: Sequence[str] = ()
    refs: Sequence[str] = ()
    shape: Shape | Mapping[str, Any] | None = None
    columns: Sequence[Column | Mapping[str, Any]] = ()
    chart: Any = None
    capabilities: Capabilities | Mapping[str, Any] | None = None
    selection: SelectionPolicy | Mapping[str, Any] | None = None
    selection_model: SelectionModel | Mapping[str, Any] | None = None
    summary: str | None = None
    selectors: Sequence[str] = ()
    python_type: str | None = None
    component: str | None = None
    entity: Mapping[str, Any] | None = None
    output: Mapping[str, Any] | None = None
    output_refs: Sequence[str] = ()
    output_type: str | None = None
    code_preview: str | None = None
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "kind": str(self.kind),
        }
        _set(item, "variable", self.variable)
        _set(item, "cellId", self.cell_id)
        _set_sequence(item, "displayCellIds", self.display_cell_ids)
        _set_sequence(item, "relatedCellIds", self.related_cell_ids)
        _set_sequence(item, "defs", self.defs)
        _set_sequence(item, "refs", self.refs)
        _set(item, "shape", _to_mapping(self.shape))
        if self.columns:
            item["columns"] = [_to_mapping(column) for column in self.columns]
        _set(item, "chart", _to_mapping(self.chart))
        _set(item, "capabilities", _to_mapping(self.capabilities))
        _set(item, "selectionPolicy", _to_mapping(self.selection))
        _set(item, "selectionModel", _to_mapping(self.selection_model))
        _set(item, "summary", self.summary)
        _set_sequence(item, "selectors", self.selectors)
        _set(item, "pythonType", self.python_type)
        _set(item, "component", self.component)
        _set(item, "entity", dict(self.entity) if self.entity is not None else None)
        _set(item, "output", dict(self.output) if self.output is not None else None)
        _set_sequence(item, "outputRefs", self.output_refs)
        _set(item, "outputType", self.output_type)
        _set(item, "codePreview", self.code_preview)
        item.update(dict(self.extensions))
        return item


TargetSpec: TypeAlias = TargetMetadata
TargetLike: TypeAlias = TargetMetadata | Mapping[str, Any]


def dataframe(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    columns: Sequence[Column | Mapping[str, Any]] = (),
    shape: Shape | Mapping[str, Any] | None = None,
    selection: SelectionPolicy | Mapping[str, Any] | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a dataframe target spec."""

    return _manual_target(
        "dataframe",
        id=id,
        label=label,
        selector=selector,
        columns=columns,
        shape=shape,
        selection=selection,
        **metadata,
    )


def table(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    columns: Sequence[Column | Mapping[str, Any]] = (),
    shape: Shape | Mapping[str, Any] | None = None,
    selection: SelectionPolicy | Mapping[str, Any] | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a table target spec."""

    return _manual_target(
        "table",
        id=id,
        label=label,
        selector=selector,
        columns=columns,
        shape=shape,
        selection=selection,
        **metadata,
    )


def visualization(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    chart: Any = None,
    selection: SelectionPolicy | Mapping[str, Any] | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a visualization target spec."""

    return _manual_target(
        "visualization",
        id=id,
        label=label,
        selector=selector,
        chart=chart,
        selection=selection,
        **metadata,
    )


def output(
    *,
    id: str,
    label: str,
    cell_id: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a first-class rendered cell output target spec."""

    return _manual_target(
        "output",
        id=id,
        label=label,
        selector=selector,
        cell_id=cell_id,
        display_cell_ids=metadata.pop("display_cell_ids", (cell_id,)),
        **metadata,
    )


def media(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build an image/audio/video/PDF style target spec."""

    return _manual_target("media", id=id, label=label, selector=selector, **metadata)


def document(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a document target spec."""

    return _manual_target("document", id=id, label=label, selector=selector, **metadata)


def ui(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a marimo UI target spec."""

    return _manual_target("ui", id=id, label=label, selector=selector, **metadata)


def anywidget(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build an anywidget target spec."""

    return _manual_target(
        "anywidget",
        id=id,
        label=label,
        selector=selector,
        **metadata,
    )


def data(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a generic data target spec."""

    return _manual_target("data", id=id, label=label, selector=selector, **metadata)


def diagnostic(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a diagnostic output target spec."""

    return _manual_target(
        "diagnostic",
        id=id,
        label=label,
        selector=selector,
        **metadata,
    )


def layout(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build a layout target spec."""

    return _manual_target("layout", id=id, label=label, selector=selector, **metadata)


def object(
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    """Build an object target spec."""

    return _manual_target("object", id=id, label=label, selector=selector, **metadata)


def target_dict(target: TargetLike) -> dict[str, Any]:
    """Convert a typed target spec or internal wire target to a dictionary."""

    if isinstance(target, TargetMetadata):
        return target.to_dict()
    return dict(target.items())


def _manual_target(
    kind: TargetKind | str,
    *,
    id: str,
    label: str,
    selector: str | None = None,
    **metadata: Any,
) -> TargetMetadata:
    selectors = list(metadata.pop("selectors", ()) or ())
    if selector:
        selectors.insert(0, selector)
    return TargetMetadata(
        id=id,
        label=label,
        kind=kind,
        selectors=tuple(dict.fromkeys(str(value) for value in selectors)),
        **metadata,
    )


def _to_mapping(value: Any) -> Any:
    if value is None:
        return None
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _set(item: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        item[key] = value


def _set_sequence(item: dict[str, Any], key: str, value: Sequence[Any]) -> None:
    if value:
        item[key] = [str(entry) for entry in value]


def target(
    value: Any,
    variable: str | None = None,
    *,
    label: str | None = None,
    kind: str | None = None,
) -> Any:
    """Wrap a rendered object with marimo-lens provenance attributes.

    The wrapper gives the frontend an exact DOM anchor, while the Lens widget
    still carries the richer graph metadata for the variable.
    """

    try:
        import marimo as mo
    except Exception as exc:  # pragma: no cover - marimo is optional at import time
        raise RuntimeError("marimo_lens.target() requires marimo") from exc

    variable = variable or _infer_variable_name(value) or "target"
    rendered = mo.as_html(value)
    text = getattr(rendered, "text", str(rendered))
    data = {
        "data-marimo-lens-var": variable,
        "data-marimo-lens-label": label or variable,
        "data-marimo-lens-kind": kind or _infer_kind(value),
    }
    attrs = " ".join(
        f'{name}="{html.escape(str(attr_value), quote=True)}"'
        for name, attr_value in data.items()
    )
    return mo.Html(f'<div class="marimo-lens-target" {attrs}>{text}</div>')


def collect_targets(
    namespace: Mapping[str, Any] | None = None,
    *,
    include: Sequence[str] | None = None,
    exclude: Sequence[str] | None = None,
    graph: Mapping[str, Any] | None = None,
    entity_registry: EntityRegistry | None = None,
) -> list[dict[str, Any]]:
    """Collect JSON-safe target metadata from a namespace.

    In a marimo notebook, calling this without arguments uses the active
    runtime globals. Passing ``include`` narrows the zero-configuration default
    to specific variable names.
    """

    if namespace is None:
        namespace = _caller_namespace()

    if graph is None:
        from .context import collect_notebook_graph

        graph = collect_notebook_graph(
            namespace=namespace,
            entity_registry=entity_registry,
        )
    else:
        graph = dict(graph)
    targets: list[dict[str, Any]] = []
    targets.extend(
        collect_entity_targets(
            namespace,
            include=include,
            exclude=exclude,
            graph=graph,
            entity_registry=entity_registry,
        )
    )
    targets.extend(
        collect_cell_output_targets(
            graph,
            exclude=exclude,
            entity_registry=entity_registry,
        )
    )
    return targets


def collect_entity_targets(
    namespace: Mapping[str, Any],
    *,
    include: Sequence[str] | None = None,
    exclude: Sequence[str] | None = None,
    graph: Mapping[str, Any],
    entity_registry: EntityRegistry | None = None,
) -> list[dict[str, Any]]:
    """Collect namespace-backed targets from variables and UI objects."""

    include_names = (
        list(include)
        if include is not None
        else _auto_include(
            namespace,
            graph=graph,
            entity_registry=entity_registry,
        )
    )
    exclude_names = set(exclude or ())
    targets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in include_names:
        if name in seen or name not in namespace:
            continue
        seen.add(name)
        if name in exclude_names:
            continue
        value = namespace[name]
        if _is_internal_value(name, value):
            continue
        target = _summarize_target(
            name,
            value,
            graph,
            entity_registry=entity_registry,
        )
        if target is not None:
            targets.append(target)
    return targets


@dataclass(frozen=True)
class CellOutputEntity:
    """A rendered cell output plus the graph metadata needed to target it."""

    cell_id: str
    value: Any
    graph: Mapping[str, Any]
    cell: Mapping[str, Any]

    @property
    def name(self) -> str:
        return f"output:{self.cell_id}"


def collect_cell_output_targets(
    graph: Mapping[str, Any],
    *,
    exclude: Sequence[str] | None = None,
    entity_registry: EntityRegistry | None = None,
) -> list[dict[str, Any]]:
    """Collect first-class targets for rendered marimo cell outputs."""

    raw_outputs = _runtime_cell_outputs()
    excluded = set(exclude or ())
    targets: list[dict[str, Any]] = []
    for raw_cell in graph.get("cells", []):
        if not isinstance(raw_cell, Mapping):
            continue
        cell = dict(raw_cell)
        cell_id = str(cell.get("id") or "")
        if not cell_id:
            continue
        target_id = f"output:{cell_id}"
        if target_id in excluded or cell_id in excluded:
            continue
        value = raw_outputs.get(cell_id, cell.get("output"))
        if not _has_rendered_output(cell, value):
            continue
        if _defines_only_internal_names(cell):
            continue
        if _is_lens_widget(value):
            continue
        target = _summarize_cell_output_target(
            CellOutputEntity(
                cell_id=cell_id,
                value=value,
                graph=graph,
                cell=cell,
            ),
            entity_registry=entity_registry,
        )
        if target is not None:
            targets.append(target)
    return targets


def _summarize_cell_output_target(
    output: CellOutputEntity,
    *,
    entity_registry: EntityRegistry | None = None,
) -> dict[str, Any] | None:
    from .inspectors import LensEntity, default_entity_registry
    from .inspectors._capabilities import capabilities as target_capabilities

    entity = LensEntity(
        name=output.name,
        value=output.value,
        graph=output.graph,
        cell_id=output.cell_id,
        display_cell_ids=(output.cell_id,),
        related_cell_ids=tuple(_related_output_cell_ids(output.cell, output.graph)),
        cell=output.cell,
    )
    inspection = (entity_registry or default_entity_registry()).inspect(entity)
    inspected = dict(inspection.metadata) if inspection is not None else {}
    inspected_kind = str(inspected.get("kind") or "object")
    output_type = str(output.cell.get("outputType") or _python_type(output.value) or "")
    label = str(inspected.get("label") or _output_label(output.cell, inspected_kind))
    columns = list(inspected.get("columns") or [])
    chart = inspected.get("chart")
    capabilities = dict(
        inspected.get("capabilities")
        or target_capabilities(
            columnar_dom=bool(columns),
            chart_part=bool(chart),
            data=inspected_kind == "data",
            diagnostic=inspected_kind == "diagnostic",
            document=inspected_kind == "document",
            media=inspected_kind == "media",
            visual_surface=inspected_kind == "visualization",
            interactive=inspected_kind in {"anywidget", "layout", "ui"},
        )
    )
    selectors = [
        f'[id="output-{_css_attr(output.cell_id)}"]',
        f'[id="cell-{_css_attr(output.cell_id)}"]',
        f'[data-cell-id="{_css_attr(output.cell_id)}"]',
    ]
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
            "id": f"output:{output.cell_id}",
            "label": label,
            "kind": "output",
            "cellId": output.cell_id,
            "displayCellIds": [output.cell_id],
            "relatedCellIds": _related_output_cell_ids(output.cell, output.graph),
            "defs": list(output.cell.get("defs") or []),
            "refs": list(output.cell.get("refs") or []),
            "outputRefs": list(output.cell.get("outputRefs") or []),
            "outputType": output_type,
            "codePreview": str(output.cell.get("codePreview") or ""),
            "shape": inspected.get("shape"),
            "columns": columns,
            "chart": chart,
            "capabilities": capabilities,
            "selectionPolicy": _output_selection_policy(
                inspected.get("selectionPolicy"),
                capabilities,
            ),
            "summary": _inspected_output_summary(
                output.cell,
                output_type,
                inspected,
                inspected_kind,
                output.value,
            ),
            "selectors": list(dict.fromkeys(selectors)),
            "pythonType": _python_type(output.value) or output_type,
            "entity": {
                "inspector": inspection.inspector_id
                if inspection is not None
                else "output",
                "family": inspected.get("family") or inspected_kind,
                "source": "cell-output",
            },
            "output": {
                "kind": inspected_kind,
                "type": output_type,
                "cellId": output.cell_id,
                "codePreview": str(output.cell.get("codePreview") or ""),
            },
        }
    )
    return target


def _runtime_cell_outputs() -> dict[str, Any]:
    ctx, _reason = _runtime_context()
    graph = getattr(ctx, "graph", None) if ctx is not None else None
    cells = getattr(graph, "cells", {}) if graph is not None else {}
    outputs: dict[str, Any] = {}
    for raw_cell_id, cell in getattr(cells, "items", lambda: [])():
        try:
            outputs[str(raw_cell_id)] = getattr(cell, "output", None)
        except Exception:
            continue
    return outputs


def _has_rendered_output(cell: Mapping[str, Any], value: Any) -> bool:
    if value is not None:
        return True
    if cell.get("output"):
        return True
    if str(cell.get("outputType") or ""):
        return True
    if bool(cell.get("hasOutputExpression", False)):
        return True
    return bool(cell.get("outputRefs"))


def _defines_only_internal_names(cell: Mapping[str, Any]) -> bool:
    defs = [str(name) for name in cell.get("defs") or []]
    return bool(defs) and all(_is_internal_name(name) for name in defs)


def _related_output_cell_ids(
    cell: Mapping[str, Any],
    graph: Mapping[str, Any],
) -> list[str]:
    cell_id = str(cell.get("id") or "")
    defs = {str(name) for name in cell.get("defs") or []}
    if not defs:
        return []
    ids = [
        str(candidate.get("id"))
        for candidate in graph.get("cells", [])
        if str(candidate.get("id")) != cell_id
        and defs.intersection(str(ref) for ref in candidate.get("refs") or [])
    ]
    return list(dict.fromkeys(ids))


def _output_label(cell: Mapping[str, Any], inspected_kind: str) -> str:
    if inspected_kind == "visualization":
        return f"Chart output from cell {cell.get('id')}"
    if inspected_kind in {"dataframe", "table"}:
        return f"Table output from cell {cell.get('id')}"
    if inspected_kind == "document":
        return f"Document output from cell {cell.get('id')}"
    if inspected_kind == "media":
        return f"Media output from cell {cell.get('id')}"
    return f"Output from cell {cell.get('id')}"


def _output_summary(cell: Mapping[str, Any], output_type: str) -> str:
    cell_id = str(cell.get("id") or "")
    type_suffix = f" ({output_type})" if output_type else ""
    return f"cell {cell_id} output{type_suffix}"


def _inspected_output_summary(
    cell: Mapping[str, Any],
    output_type: str,
    inspected: Mapping[str, Any],
    inspected_kind: str,
    value: Any,
) -> str:
    if inspected_kind != "object" or value is not None:
        summary = inspected.get("summary")
        if summary:
            return str(summary)
    return _output_summary(cell, output_type)


def _output_selection_policy(
    value: Any,
    capabilities: Mapping[str, bool],
) -> dict[str, Any]:
    policy = value if isinstance(value, Mapping) else {}
    raw_prefer = policy.get("prefer") or []
    prefer = [str(surface) for surface in raw_prefer if str(surface)]
    if not prefer:
        if capabilities.get("columnarGrid"):
            prefer.append("columnar-grid")
        if capabilities.get("columnarDom"):
            prefer.append("columnar-dom")
        if capabilities.get("chartPart"):
            prefer.append("chart-unit")
        if capabilities.get("visualSurface"):
            prefer.append("visual-surface")
        if capabilities.get("media"):
            prefer.append("media")
        if capabilities.get("document"):
            prefer.append("document")
        if capabilities.get("interactive"):
            prefer.append("interactive")
    prefer = _with_before_selector(prefer, "display-cell")
    prefer.append("selector")
    raw_context = policy.get("context")
    context = (
        {str(key): value for key, value in raw_context.items()}
        if isinstance(raw_context, Mapping)
        else {}
    )
    return {"prefer": list(dict.fromkeys(prefer)), "context": context}


def _with_before_selector(prefer: list[str], surface: str) -> list[str]:
    if surface in prefer:
        return prefer
    try:
        selector_index = prefer.index("selector")
    except ValueError:
        return [*prefer, surface]
    return [*prefer[:selector_index], surface, *prefer[selector_index:]]


def _python_type(value: Any) -> str:
    if value is None:
        return ""
    return type(value).__module__ + "." + type(value).__qualname__


__all__ = [
    "CellOutputEntity",
    "Capabilities",
    "Column",
    "Shape",
    "TargetKind",
    "TargetLike",
    "TargetMetadata",
    "TargetSpec",
    "anywidget",
    "collect_cell_output_targets",
    "collect_entity_targets",
    "collect_targets",
    "data",
    "dataframe",
    "diagnostic",
    "document",
    "layout",
    "media",
    "object",
    "output",
    "table",
    "target",
    "target_dict",
    "ui",
    "visualization",
]
