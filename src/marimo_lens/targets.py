"""Public target helpers and namespace target collection."""

from __future__ import annotations

import html
from functools import partial
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ._marimo_runtime import runtime_context as _runtime_context
from ._target_contract import (
    Capabilities,
    Column,
    Shape,
    TargetKind,
    TargetLike,
    TargetMetadata,
    target_dict,
)
from ._target_payload import (
    build_target_payload,
    css_attr as _css_attr,
    python_type_name,
    target_extensions,
    target_family,
)
from .inspectors import EntityRegistry
from .metadata import (
    _auto_include,
    _caller_namespace,
    _infer_kind,
    _infer_variable_name,
    _is_internal_name,
    _is_lens_widget,
    _is_internal_value,
    _jsonable,
    _normalize_targets,
    _summarize_target,
)
from .selection import Model as SelectionModel
from .selection import Policy as SelectionPolicy


def create(
    kind: TargetKind | str,
    *,
    id: str,
    label: str,
    selector: str | None = None,
    selectors: Sequence[str] = (),
    variable: str | None = None,
    cell_id: str | None = None,
    display_cell_ids: Sequence[str] = (),
    related_cell_ids: Sequence[str] = (),
    defs: Sequence[str] = (),
    refs: Sequence[str] = (),
    shape: Shape | Mapping[str, Any] | None = None,
    columns: Sequence[Column | Mapping[str, Any]] = (),
    chart: Any = None,
    capabilities: Capabilities | Mapping[str, Any] | None = None,
    selection: SelectionPolicy | Mapping[str, Any] | None = None,
    selection_model: SelectionModel | Mapping[str, Any] | None = None,
    summary: str | None = None,
    python_type: str | None = None,
    component: str | None = None,
    entity: Mapping[str, Any] | None = None,
    output: Mapping[str, Any] | None = None,
    output_refs: Sequence[str] = (),
    output_type: str | None = None,
    code_preview: str | None = None,
    extensions: Mapping[str, Any] | None = None,
) -> TargetMetadata:
    """Build a manual target spec for any supported target kind."""

    if kind == "output" and not display_cell_ids:
        display_cell_ids = (str(cell_id),) if cell_id is not None else ()
    selector_values = list(selectors or ())
    if selector:
        selector_values.insert(0, selector)
    return TargetMetadata(
        id=id,
        label=label,
        kind=kind,
        variable=variable,
        cell_id=cell_id,
        display_cell_ids=display_cell_ids,
        related_cell_ids=related_cell_ids,
        defs=defs,
        refs=refs,
        shape=shape,
        columns=columns,
        chart=chart,
        capabilities=capabilities,
        selection=selection,
        selection_model=selection_model,
        summary=summary,
        selectors=tuple(dict.fromkeys(str(value) for value in selector_values)),
        python_type=python_type,
        component=component,
        entity=entity,
        output=output,
        output_refs=output_refs,
        output_type=output_type,
        code_preview=code_preview,
        extensions=dict(extensions or {}),
    )


dataframe = partial(create, "dataframe")
table = partial(create, "table")
visualization = partial(create, "visualization")
output = partial(create, "output")
media = partial(create, "media")
document = partial(create, "document")
ui = partial(create, "ui")
anywidget = partial(create, "anywidget")
data = partial(create, "data")
diagnostic = partial(create, "diagnostic")
layout = partial(create, "layout")
object = partial(create, "object")


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
    cell_outputs: Mapping[str, Any] | None = None,
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
            include=include,
            exclude=exclude,
            cell_outputs=cell_outputs,
            entity_registry=entity_registry,
        )
    )
    return _normalize_targets(targets)


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
    include: Sequence[str] | None = None,
    exclude: Sequence[str] | None = None,
    cell_outputs: Mapping[str, Any] | None = None,
    entity_registry: EntityRegistry | None = None,
) -> list[dict[str, Any]]:
    """Collect first-class targets for rendered marimo cell outputs."""

    raw_outputs = (
        _runtime_cell_outputs() if cell_outputs is None else dict(cell_outputs)
    )
    included = set(include or ())
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
        cell_names = _output_cell_names(cell)
        if include is not None and not (
            target_id in included
            or cell_id in included
            or cell_names.intersection(included)
        ):
            continue
        if (
            target_id in excluded
            or cell_id in excluded
            or cell_names.intersection(excluded)
        ):
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
    output_type = str(
        output.cell.get("outputType") or python_type_name(output.value) or ""
    )
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
    return _jsonable(
        build_target_payload(
            id=f"output:{output.cell_id}",
            label=label,
            kind="output",
            cell_id=output.cell_id,
            display_cell_ids=(output.cell_id,),
            related_cell_ids=_related_output_cell_ids(output.cell, output.graph),
            defs=[str(item) for item in output.cell.get("defs") or []],
            refs=[str(item) for item in output.cell.get("refs") or []],
            output_refs=[str(item) for item in output.cell.get("outputRefs") or []],
            output_type=output_type,
            code_preview=str(output.cell.get("codePreview") or ""),
            shape=inspected.get("shape"),
            columns=columns,
            chart=chart,
            capabilities=capabilities,
            selection_model=_optional_mapping(inspected.get("selectionModel")),
            selection_policy=_optional_mapping(inspected.get("selectionPolicy")),
            summary=_inspected_output_summary(
                output.cell,
                output_type,
                inspected,
                inspected_kind,
                output.value,
            ),
            selectors=selectors,
            python_type=python_type_name(output.value) or output_type,
            entity={
                "inspector": inspection.inspector_id
                if inspection is not None
                else "output",
                "family": target_family(inspected, inspected_kind),
                "source": "cell-output",
            },
            output={
                "kind": inspected_kind,
                "type": output_type,
                "cellId": output.cell_id,
                "codePreview": str(output.cell.get("codePreview") or ""),
            },
            extensions=target_extensions(inspected),
        )
    )


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


def _output_cell_names(cell: Mapping[str, Any]) -> set[str]:
    return {
        str(name)
        for key in ("defs", "refs", "outputRefs")
        for name in (cell.get(key) or [])
        if str(name)
    }


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


def _optional_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


__all__ = [
    "CellOutputEntity",
    "Capabilities",
    "Column",
    "Shape",
    "TargetKind",
    "TargetLike",
    "TargetMetadata",
    "anywidget",
    "collect_cell_output_targets",
    "collect_entity_targets",
    "collect_targets",
    "create",
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
