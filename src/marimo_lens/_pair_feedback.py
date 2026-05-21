from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import islice
from typing import Any

from ._contract import (
    CHART_PART_KINDS,
    SELECTION_GRANULARITIES,
)
from ._serialization import (
    MAX_VALUE_DEPTH,
    MAX_VALUE_ITEMS,
    context_policy,
    describe_value,
    safe_value,
)
from .metadata import _normalize_targets

PAIR_FEEDBACK_PROTOCOL = "marimo-pair.feedback"
PAIR_FEEDBACK_VERSION = 1
PAIR_GRAPH_VALUE_DEPTH = MAX_VALUE_DEPTH + 4


@dataclass(frozen=True)
class AnnotationContext:
    """Normalized annotation subtarget evidence reused by renderers and packets."""

    id: str
    semantic: Mapping[str, Any]
    column: Any
    column_dtype: Any
    chart_part: Any
    dom_evidence: Mapping[str, Any]


def _annotation_context_view(
    annotation: Mapping[str, Any],
    *,
    annotation_id: str,
) -> AnnotationContext:
    semantic = _normalized_semantic_selection(annotation, annotation_id=annotation_id)
    semantic_data = semantic.get("data") if isinstance(semantic, Mapping) else {}
    column = annotation.get("column") or (
        semantic_data.get("column") if isinstance(semantic_data, Mapping) else ""
    )
    column_dtype = annotation.get("columnDtype") or (
        semantic_data.get("columnDtype") if isinstance(semantic_data, Mapping) else ""
    )
    return AnnotationContext(
        id=annotation_id,
        semantic=semantic,
        column=column,
        column_dtype=column_dtype,
        chart_part=_normalized_chart_part(
            _chart_part(annotation, semantic),
            annotation_id=annotation_id,
        ),
        dom_evidence=_dom_evidence(annotation),
    )


@dataclass(frozen=True)
class PairAnnotation:
    """Machine-readable feedback for one Lens annotation."""

    id: str
    index: int
    created_at: str
    request: str
    target: Mapping[str, Any]
    target_snapshot: Mapping[str, Any]
    cells: Mapping[str, Any]
    evidence: Mapping[str, Any]
    marimo_pair: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "index": self.index,
            "createdAt": self.created_at,
            "request": self.request,
            "target": dict(self.target),
            "targetSnapshot": dict(self.target_snapshot),
            "cells": dict(self.cells),
            "evidence": dict(self.evidence),
            "marimoPair": dict(self.marimo_pair),
        }


@dataclass(frozen=True)
class PairFeedbackPacket:
    """Versioned marimo-pair feedback packet."""

    generated_at: str
    source: Mapping[str, Any]
    notebook: Mapping[str, Any]
    targets: Sequence[Mapping[str, Any]]
    target_index: Mapping[str, Any]
    display_provenance: Sequence[Mapping[str, Any]]
    context_policy: Mapping[str, Any]
    summary: Mapping[str, Any]
    groups: Sequence[Mapping[str, Any]]
    instructions: Sequence[str]
    annotations: Sequence[Mapping[str, Any]]
    markdown: str
    extensions: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "protocol": PAIR_FEEDBACK_PROTOCOL,
            "version": PAIR_FEEDBACK_VERSION,
            "generatedAt": self.generated_at,
            "source": dict(self.source),
            "notebook": dict(self.notebook),
            "targets": [dict(target) for target in self.targets],
            "targetIndex": dict(self.target_index),
            "displayProvenance": [
                dict(provenance) for provenance in self.display_provenance
            ],
            "contextPolicy": dict(self.context_policy),
            "summary": dict(self.summary),
            "groups": [dict(group) for group in self.groups],
            "instructions": list(self.instructions),
            "annotations": [dict(annotation) for annotation in self.annotations],
            "markdown": self.markdown,
        }
        if self.extensions:
            payload["extensions"] = dict(self.extensions)
        return payload


def render_markdown(
    annotations: Sequence[Mapping[str, Any]],
    notebook: Mapping[str, Any] | None = None,
) -> str:
    if not annotations:
        return ""
    filename = str((notebook or {}).get("filename") or "marimo notebook")
    lines = [f"## marimo lens feedback: {filename}", ""]
    for index, annotation in enumerate(annotations, start=1):
        annotation_id = str(annotation.get("id") or f"annotation-{index}")
        context = _annotation_context_view(annotation, annotation_id=annotation_id)
        target_name = str(
            annotation.get("variable")
            or annotation.get("targetLabel")
            or "unknown target"
        )
        lines.append(f"### {index}. {target_name}")
        if annotation.get("kind"):
            lines.append(f"- Kind: `{annotation['kind']}`")
        if context.column:
            dtype = f" ({context.column_dtype})" if context.column_dtype else ""
            lines.append(f"- Column: `{context.column}`{dtype}")
        if isinstance(context.chart_part, Mapping):
            part_kind = context.chart_part.get("kind") or "part"
            part_label = context.chart_part.get("label") or "unknown"
            library = context.chart_part.get("library") or "chart"
            lines.append(f"- Chart part: `{library}:{part_kind}` {part_label}")
        if annotation.get("cellId"):
            lines.append(f"- Defining cell: `{annotation['cellId']}`")
        if annotation.get("displayCellId"):
            lines.append(f"- Display cell: `{annotation['displayCellId']}`")
        if annotation.get("kind") == "output" and annotation.get("displayCellId"):
            lines.append(f"- Selected output cell: `{annotation['displayCellId']}`")
        if annotation.get("elementPath"):
            lines.append(f"- DOM: `{annotation['elementPath']}`")
        if context.semantic:
            lines.append(
                "- Selection: "
                f"`{context.semantic.get('kind') or 'target'}` "
                f"{context.semantic.get('label') or ''}".strip()
            )
        lines.append(f"- Feedback: {annotation.get('comment', '')}")
        lines.append("")
    return "\n".join(lines).strip()


def build_pair_feedback(
    annotations: Sequence[Mapping[str, Any]],
    notebook: Mapping[str, Any] | None,
    targets: Sequence[Mapping[str, Any]],
    *,
    title: str,
    markdown: str,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    graph = dict(notebook or {})
    normalized_targets = _normalize_targets(targets)
    target_lookup = _target_lookup(normalized_targets)
    items = [
        _pair_annotation(index, annotation, graph, target_lookup)
        for index, annotation in enumerate(annotations, start=1)
    ]
    target_catalog = _target_catalog(normalized_targets)
    return PairFeedbackPacket(
        generated_at=datetime.now(timezone.utc).isoformat(),
        source={
            "package": "marimo-lens",
            "title": title,
        },
        notebook=_pair_notebook(graph),
        targets=target_catalog,
        target_index=_target_index(target_catalog),
        display_provenance=_display_provenance(items),
        context_policy=context_policy(),
        summary=_pair_summary(items, graph),
        groups=_pair_groups(items),
        instructions=[
            "Re-discover and inspect the live marimo session before editing; this packet is feedback, not the source of truth.",
            "Use `async with marimo._code_mode.get_context() as ctx:` and call ctx methods synchronously inside the context manager.",
            "Read current cell code from marimo._code_mode ctx.cells because disk may lag the running notebook.",
            "Apply notebook changes with ctx.edit_cell(..., code=<full cell body>) and ctx.run_cell(...); never patch the notebook file directly.",
            "Preserve unrelated cells and use the provided cell ids, variables, refs, and DOM evidence to minimize the edit surface.",
        ],
        annotations=items,
        markdown=markdown,
        extensions=safe_value(dict(metadata)) if metadata else None,
    ).to_dict()


def render_pair_prompt(payload: Mapping[str, Any]) -> str:
    if not payload.get("annotations"):
        return ""
    packet = json.dumps(payload, indent=2, sort_keys=True)
    return f"""# marimo-pair feedback packet

Use this packet as user feedback for the running marimo notebook. Re-inspect the live session first, then use `async with marimo._code_mode.get_context() as ctx:` for notebook edits. Call ctx methods synchronously inside that context manager. Do not edit the notebook file directly.

If marimo-lens is available, report your work back through it from your scratchpad before and after notebook operations:

```python
from marimo_lens import find_lens

lens = find_lens(required=False)
if lens is not None:
    lens.agent_started(label="marimo-pair")
```

As you inspect and edit the notebook:

- call `lens.mark_cells([...], kind="read")` for cells you inspect
- call `lens.mark_cells([...], kind="claimed")` before editing
- after `ctx.edit_cell(...)`, call `lens.mark_cells([...], kind="edited")`
- after `ctx.run_cell(...)`, call `lens.mark_cells([...], kind="ran")`
- if something fails, call `lens.mark_cells([...], kind="failed", note=...)`
- if human input is needed, call `lens.mark_cells([...], kind="needs-review", note=...)`

When you address a Lens annotation, call `lens.resolve_annotation(annotation_id, status="addressed", note="...")`.

At the end, call:

```python
lens.agent_finished(
    summary="...",
    cells_read=[...],
    cells_edited=[...],
    cells_run=[...],
    annotations_addressed=[...],
)
```

Keep the existing marimo._code_mode instructions. This Lens reporting protocol is additional provenance, not a replacement.

```json
{packet}
```"""


def _pair_notebook(graph: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "available": bool(graph.get("available", False)),
        "collectedAt": graph.get("collectedAt") or "",
        "filename": graph.get("filename") or "",
        "currentCellId": graph.get("currentCellId") or "",
        "reason": graph.get("reason") or "",
        "runtime": _pair_graph_value(graph.get("runtime") or {}),
        "cells": _pair_graph_value(_graph_cells(graph)),
        "definitions": _pair_graph_value(graph.get("definitions") or {}),
        "edges": _pair_graph_value(graph.get("edges") or []),
        "globals": _pair_graph_value(graph.get("globals") or []),
        "controls": _pair_graph_value(graph.get("controls") or {}),
    }


def _graph_cells(graph: Mapping[str, Any]) -> list[Any]:
    cells = graph.get("cells")
    if isinstance(cells, Sequence) and not isinstance(cells, (str, bytes, bytearray)):
        return list(cells)
    return []


def _pair_graph_value(
    value: Any,
    *,
    depth: int = 0,
    seen: set[int] | None = None,
) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return safe_value(value)
    if depth >= PAIR_GRAPH_VALUE_DEPTH:
        return safe_value(value, depth=depth)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return safe_value(value)
    seen_ids = seen or set()
    value_id = id(value)
    if value_id in seen_ids:
        return describe_value(value)
    next_seen = {value_id, *seen_ids}
    if isinstance(value, Mapping):
        items = list(value.items())
        return {
            str(key): _pair_graph_value(item, depth=depth + 1, seen=next_seen)
            for key, item in items[:MAX_VALUE_ITEMS]
        }
    if isinstance(value, Sequence):
        items = list(value)
        return [
            _pair_graph_value(item, depth=depth + 1, seen=next_seen)
            for item in items[:MAX_VALUE_ITEMS]
        ]
    if isinstance(value, Iterable):
        return [
            _pair_graph_value(item, depth=depth + 1, seen=next_seen)
            for item in islice(value, MAX_VALUE_ITEMS)
        ]
    return safe_value(value, depth=depth)


def _target_lookup(
    targets: Sequence[Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    lookup: dict[str, Mapping[str, Any]] = {}
    for target_item in targets:
        target_id = target_item.get("id")
        if target_id:
            lookup[str(target_id)] = target_item
    return lookup


def _target_catalog(targets: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [dict(target) for target in targets]


def _target_index(targets: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for target in targets:
        target_id = str(target.get("id") or "")
        if not target_id:
            continue
        index[target_id] = {
            "id": target_id,
            "label": target.get("label") or "",
            "variable": target.get("variable") or "",
            "kind": target.get("kind") or "object",
            "cellId": target.get("cellId") or "",
            "displayCellIds": list(target.get("displayCellIds") or []),
            "relatedCellIds": list(target.get("relatedCellIds") or []),
            "defs": list(target.get("defs") or []),
            "refs": list(target.get("refs") or []),
        }
    return index


def _display_provenance(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    provenance: list[dict[str, Any]] = []
    for item in items:
        target = item.get("target", {})
        cells = item.get("cells", {})
        evidence = item.get("evidence", {})
        provenance.append(
            {
                "annotationId": item.get("id") or "",
                "targetId": target.get("id") or "",
                "targetStatus": target.get("status") or "current",
                "variable": target.get("variable") or "",
                "definitionCell": cells.get("definition") or "",
                "displayCell": cells.get("display") or "",
                "outputCell": cells.get("output") or "",
                "relatedCellIds": list(cells.get("related") or []),
                "selectionEvidence": evidence.get("semanticSelection") or None,
                "domEvidence": {
                    "element": evidence.get("element") or "",
                    "elementPath": evidence.get("elementPath") or "",
                    "documentPoint": evidence.get("documentPoint") or {},
                    "boundingBox": evidence.get("boundingBox") or {},
                },
            }
        )
    return provenance


def _pair_annotation(
    index: int,
    annotation: Mapping[str, Any],
    graph: Mapping[str, Any],
    targets: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    target, target_status = _annotation_target(annotation, targets)
    variable = target.get("variable") or annotation.get("variable")
    cells = _annotation_cells(
        annotation,
        target,
        target_status=target_status,
        variable=variable,
        graph=graph,
    )
    annotation_id = str(annotation.get("id") or f"annotation-{index}")
    context = _annotation_context_view(annotation, annotation_id=annotation_id)
    target_snapshot = dict(target)
    return PairAnnotation(
        id=annotation_id,
        index=index,
        created_at=str(annotation.get("createdAt") or ""),
        request=str(annotation.get("comment") or ""),
        target=_annotation_target_payload(
            target,
            target_status=target_status,
            variable=variable,
            column=context.column,
            column_dtype=context.column_dtype,
            chart_part=context.chart_part,
            semantic=context.semantic,
        ),
        target_snapshot=target_snapshot,
        cells=cells,
        evidence=_annotation_evidence(
            annotation, context.dom_evidence, context.semantic
        ),
        marimo_pair=_marimo_pair_instruction(cells, target_status=target_status),
    ).to_dict()


def _annotation_cells(
    annotation: Mapping[str, Any],
    target: Mapping[str, Any],
    *,
    target_status: str,
    variable: Any,
    graph: Mapping[str, Any],
) -> dict[str, Any]:
    has_editable_target = target_status == "current"
    definition_cell = (
        (
            _validated_target_cell(target.get("cellId"), graph)
            if has_editable_target
            else None
        )
        or (_first_definition_cell(variable, graph) if has_editable_target else None)
        or (
            _validated_annotation_cell(annotation, "cellId", target, graph)
            if has_editable_target
            else None
        )
    )
    display_cell = (
        _first_display_cell(target, definition_cell, graph)
        if has_editable_target
        else None
    ) or (
        _validated_annotation_cell(annotation, "displayCellId", target, graph)
        if has_editable_target
        else None
    )
    output_cell = _selected_output_cell(
        annotation if has_editable_target else {},
        target if has_editable_target else {},
        display_cell,
        graph,
    )
    if target.get("kind") == "output" and output_cell and not display_cell:
        display_cell = output_cell
    edit_focus = definition_cell or output_cell
    downstream = _downstream_cells(edit_focus, graph)
    target_related = (
        [
            *_validated_target_cells(target.get("displayCellIds") or [], graph),
            *_validated_target_cells(target.get("relatedCellIds") or [], graph),
        ]
        if has_editable_target
        else []
    )
    related_cells = _unique_strings(
        [
            definition_cell,
            display_cell,
            output_cell,
            edit_focus,
            *target_related,
            *downstream,
        ]
    )
    return {
        "definition": definition_cell or "",
        "display": display_cell or "",
        "output": output_cell or "",
        "editFocus": edit_focus or "",
        "related": related_cells,
        "downstream": downstream,
        "previews": _cell_previews(related_cells, graph),
    }


def _annotation_target_payload(
    target: Mapping[str, Any],
    *,
    target_status: str,
    variable: Any,
    column: Any,
    column_dtype: Any,
    chart_part: Any,
    semantic: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "id": target.get("id") or "",
        "label": target.get("label") or variable or "",
        "variable": variable or "",
        "kind": target.get("kind") or "object",
        "status": target_status,
        "column": column or "",
        "columnDtype": column_dtype or "",
        "chartPart": chart_part,
        "semanticSelection": semantic or None,
        "pythonType": target.get("pythonType") or "",
        "summary": target.get("summary") or "",
        "shape": target.get("shape"),
        "defs": target.get("defs") or [],
        "refs": target.get("refs") or [],
        "output": target.get("output") or {},
        "outputType": target.get("outputType") or "",
        "codePreview": target.get("codePreview") or "",
    }


def _annotation_evidence(
    annotation: Mapping[str, Any],
    dom_evidence: Mapping[str, Any],
    semantic: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "element": dom_evidence["element"],
        "elementPath": dom_evidence["elementPath"],
        "semanticSelection": semantic or None,
        "documentPoint": dom_evidence["documentPoint"],
        "boundingBox": dom_evidence["boundingBox"],
        "context": _annotation_context(annotation),
    }


def _marimo_pair_instruction(
    cells: Mapping[str, Any],
    *,
    target_status: str,
) -> dict[str, Any]:
    has_editable_target = target_status == "current"
    edit_focus = cells.get("editFocus")
    definition_cell = cells.get("definition")
    output_cell = cells.get("output")
    return {
        "editBoundary": {
            "mode": "marimo-code-mode",
            "cellIds": _unique_strings([edit_focus, definition_cell, output_cell])
            if has_editable_target
            else [],
            "smallestSafeSurface": "full-cell-body",
        },
        "readBeforeEdit": list(cells.get("related") or [])
        if has_editable_target
        else [],
        "runAfterEdit": _unique_strings([edit_focus]) if has_editable_target else [],
        "reportingProtocol": {
            "start": "lens.agent_started(label='marimo-pair')",
            "markRead": "lens.mark_cells(cell_ids, kind='read')",
            "markClaimed": "lens.mark_cells(cell_ids, kind='claimed')",
            "markEdited": "lens.mark_cells(cell_ids, kind='edited')",
            "markRan": "lens.mark_cells(cell_ids, kind='ran')",
            "markFailed": "lens.mark_cells(cell_ids, kind='failed', note='...')",
            "markNeedsReview": "lens.mark_cells(cell_ids, kind='needs-review', note='...')",
            "resolveAddressed": "lens.resolve_annotation(annotation_id, status='addressed', note='...')",
            "resolveBlocked": "lens.resolve_annotation(annotation_id, status='blocked', note='...')",
            "resolveNeedsHuman": "lens.resolve_annotation(annotation_id, status='needs_human', note='...')",
            "finish": "lens.agent_finished(summary=..., cells_read=[...], cells_edited=[...], cells_run=[...])",
        },
        "editGuardrail": (
            "Use marimo._code_mode ctx.edit_cell with the full replacement cell body, then run the edited cell."
            if has_editable_target
            else "Do not edit from this stale Lens annotation alone; first re-identify a current live target."
        ),
    }


def _annotation_target(
    annotation: Mapping[str, Any],
    targets: Mapping[str, Mapping[str, Any]],
) -> tuple[Mapping[str, Any], str]:
    target_id = annotation.get("targetId")
    if not target_id:
        raise ValueError("Lens annotations require targetId")
    target = targets.get(str(target_id))
    if target is not None:
        return target, "current"
    snapshot = annotation.get("targetSnapshot")
    if isinstance(snapshot, Mapping):
        snapshot_target = dict(snapshot)
        snapshot_target["id"] = str(target_id)
        snapshot_target.setdefault(
            "label",
            annotation.get("targetLabel") or annotation.get("variable") or target_id,
        )
        snapshot_target.setdefault("kind", annotation.get("kind") or "object")
        try:
            return _normalize_targets([snapshot_target])[0], "snapshot"
        except ValueError as exc:
            return _missing_target(
                annotation,
                str(target_id),
                reason=f"invalid targetSnapshot: {exc}",
            ), "invalid-snapshot"
    return _missing_target(
        annotation,
        str(target_id),
        reason="target is absent and annotation has no validated targetSnapshot",
    ), "missing"


def _missing_target(
    annotation: Mapping[str, Any],
    target_id: str,
    *,
    reason: str,
) -> Mapping[str, Any]:
    return {
        "id": target_id,
        "label": annotation.get("targetLabel")
        or annotation.get("variable")
        or target_id,
        "variable": annotation.get("variable") or "",
        "kind": "diagnostic",
        "cellId": "",
        "displayCellIds": [],
        "relatedCellIds": [],
        "defs": [],
        "refs": [],
        "summary": reason,
        "extensions": {
            "missingTarget": True,
            "requestedKind": annotation.get("kind") or "",
        },
    }


def _semantic_selection(annotation: Mapping[str, Any]) -> Mapping[str, Any]:
    semantic = annotation.get("semanticSelection")
    return semantic if isinstance(semantic, Mapping) else {}


def _normalized_semantic_selection(
    annotation: Mapping[str, Any],
    *,
    annotation_id: str,
) -> Mapping[str, Any]:
    semantic = _semantic_selection(annotation)
    if not semantic:
        return {}
    granularity = semantic.get("granularity")
    if granularity is not None and str(granularity) not in SELECTION_GRANULARITIES:
        valid = ", ".join(SELECTION_GRANULARITIES)
        raise ValueError(
            f"Lens annotation {annotation_id} has unknown selection granularity: "
            f"{granularity}. Valid values: {valid}"
        )
    semantic_copy = dict(semantic)
    data = semantic_copy.get("data")
    if isinstance(data, Mapping) and isinstance(data.get("chartPart"), Mapping):
        data_copy = dict(data)
        data_copy["chartPart"] = _normalized_chart_part(
            data["chartPart"],
            annotation_id=annotation_id,
        )
        semantic_copy["data"] = data_copy
    return safe_value(semantic_copy)


def _normalized_chart_part(value: Any, *, annotation_id: str) -> Any:
    if not isinstance(value, Mapping):
        return value
    part_kind = value.get("kind")
    if not str(part_kind or "").strip():
        raise ValueError(f"Lens annotation {annotation_id} chart part requires kind")
    if str(part_kind) not in CHART_PART_KINDS:
        valid = ", ".join(CHART_PART_KINDS)
        raise ValueError(
            f"Lens annotation {annotation_id} has unknown chart part kind: "
            f"{part_kind}. Valid values: {valid}"
        )
    label = value.get("label")
    if not str(label or "").strip():
        raise ValueError(f"Lens annotation {annotation_id} chart part requires label")
    part = {str(key): item for key, item in value.items() if item is not None}
    allowed = {
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
    }
    unknown = {key: part.pop(key) for key in sorted(set(part) - allowed)}
    if unknown:
        extensions = part.get("extensions")
        part["extensions"] = {
            **(dict(extensions) if isinstance(extensions, Mapping) else {}),
            **unknown,
        }
    return safe_value(part)


def _dom_evidence(annotation: Mapping[str, Any]) -> dict[str, Any]:
    raw = annotation.get("domEvidence")
    evidence = raw if isinstance(raw, Mapping) else {}
    document_point = evidence.get("documentPoint")
    if not isinstance(document_point, Mapping):
        document_point = {
            "x": annotation.get("documentX") or 0,
            "y": annotation.get("documentY") or 0,
        }
    bounding_box = evidence.get("boundingBox")
    if not isinstance(bounding_box, Mapping):
        bounding_box = annotation.get("boundingBox") or {
            "x": 0,
            "y": 0,
            "width": 0,
            "height": 0,
        }
    return {
        "element": str(evidence.get("element") or annotation.get("element") or ""),
        "elementPath": str(
            evidence.get("elementPath") or annotation.get("elementPath") or ""
        ),
        "documentPoint": safe_value(dict(document_point)),
        "boundingBox": safe_value(dict(bounding_box)),
    }


def _annotation_context(annotation: Mapping[str, Any]) -> dict[str, Any]:
    raw = annotation.get("context")
    if not isinstance(raw, Mapping):
        return {}
    selection_context = raw.get("selectionContext")
    return (
        {"selectionContext": safe_value(dict(selection_context))}
        if isinstance(selection_context, Mapping)
        else {}
    )


def _chart_part(
    annotation: Mapping[str, Any],
    semantic: Mapping[str, Any] | None = None,
) -> Any:
    if annotation.get("chartPart"):
        return annotation.get("chartPart")
    data = (semantic or _semantic_selection(annotation)).get("data") or {}
    if isinstance(data, Mapping):
        return data.get("chartPart")
    return None


def _first_definition_cell(
    variable: Any,
    graph: Mapping[str, Any],
) -> str | None:
    if not variable:
        return None
    cells = graph.get("definitions", {}).get(str(variable), [])
    for cell_id in cells:
        cell_text = _validated_target_cell(cell_id, graph)
        if cell_text:
            return cell_text
    return None


def _first_display_cell(
    target: Mapping[str, Any],
    definition_cell: Any,
    graph: Mapping[str, Any],
) -> str | None:
    for cell_id in target.get("displayCellIds") or []:
        cell_text = _validated_target_cell(cell_id, graph)
        if cell_text and cell_text != str(definition_cell):
            return cell_text
    return None


def _selected_output_cell(
    annotation: Mapping[str, Any],
    target: Mapping[str, Any],
    display_cell: Any,
    graph: Mapping[str, Any],
) -> str | None:
    for cell_id in target.get("displayCellIds") or []:
        cell_text = _validated_target_cell(cell_id, graph)
        if cell_text:
            return cell_text
    if display_cell:
        return str(display_cell)
    if target.get("kind") == "output":
        return _validated_target_cell(target.get("cellId"), graph)
    return _validated_annotation_cell(annotation, "displayCellId", target, graph)


def _validated_annotation_cell(
    annotation: Mapping[str, Any],
    key: str,
    target: Mapping[str, Any],
    graph: Mapping[str, Any],
) -> str | None:
    cell_id = annotation.get(key)
    if not cell_id:
        return None
    cell_text = _validated_target_cell(cell_id, graph)
    if not cell_text:
        return None
    if key == "displayCellId":
        target_display_ids = set(
            _validated_target_cells(target.get("displayCellIds") or [], graph)
        )
        if target_display_ids and cell_text not in target_display_ids:
            return None
    target_cell_id = _validated_target_cell(target.get("cellId"), graph)
    if key == "cellId" and target_cell_id and cell_text != target_cell_id:
        return None
    return cell_text


def _validated_target_cells(
    cell_ids: Iterable[Any],
    graph: Mapping[str, Any],
) -> list[str]:
    return _unique_strings(
        _validated_target_cell(cell_id, graph) for cell_id in cell_ids
    )


def _validated_target_cell(cell_id: Any, graph: Mapping[str, Any]) -> str | None:
    if not cell_id:
        return None
    cell_text = str(cell_id)
    graph_cell_ids = _graph_cell_ids(graph)
    if not graph_cell_ids or cell_text not in graph_cell_ids:
        return None
    return cell_text


def _graph_cell_ids(graph: Mapping[str, Any]) -> set[str]:
    ids: set[str] = set()
    for cell in _graph_cells(graph):
        if isinstance(cell, Mapping) and cell.get("id"):
            ids.add(str(cell["id"]))
    return ids


def _downstream_cells(cell_id: Any, graph: Mapping[str, Any]) -> list[str]:
    if not cell_id:
        return []
    return _unique_strings(
        _validated_target_cell(edge.get("to"), graph)
        for edge in graph.get("edges", [])
        if str(edge.get("from")) == str(cell_id)
    )


def _cell_previews(
    cell_ids: Sequence[str],
    graph: Mapping[str, Any],
) -> list[dict[str, Any]]:
    previews: list[dict[str, Any]] = []
    for cell_id in cell_ids:
        cell = _cell_by_id(cell_id, graph)
        if cell is None:
            continue
        previews.append(
            {
                "id": cell_id,
                "defs": cell.get("defs", []),
                "refs": cell.get("refs", []),
                "outputRefs": cell.get("outputRefs", []),
                "hasOutputExpression": bool(cell.get("hasOutputExpression", False)),
                "status": cell.get("status", ""),
                "stale": cell.get("stale", False),
                "disabled": cell.get("disabled", False),
                "codePreview": cell.get("codePreview", ""),
            }
        )
    return previews


def _cell_by_id(cell_id: str | None, graph: Mapping[str, Any]) -> dict[str, Any] | None:
    if cell_id is None:
        return None
    for cell in graph.get("cells", []):
        if str(cell.get("id")) == cell_id:
            return dict(cell)
    return None


def _pair_summary(
    items: Sequence[Mapping[str, Any]],
    graph: Mapping[str, Any],
) -> dict[str, Any]:
    control_summary = graph.get("controls", {}).get("summary", {})
    return {
        "annotationCount": len(items),
        "targetVariables": _unique_strings(
            item.get("target", {}).get("variable") for item in items
        ),
        "targetCells": _unique_strings(
            cell_id
            for item in items
            for cell_id in item.get("cells", {}).get("related", [])
        ),
        "uiElementCount": int(control_summary.get("uiElementCount", 0) or 0),
        "widgetCount": int(control_summary.get("widgetCount", 0) or 0),
        "traitletsObjectCount": int(
            control_summary.get("traitletsObjectCount", 0) or 0
        ),
    }


def _pair_groups(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for item in items:
        cells = item.get("cells", {})
        cell_id = cells.get("editFocus") or cells.get("definition") or "unmapped"
        grouped.setdefault(str(cell_id), []).append(item)
    groups = []
    for cell_id, group_items in grouped.items():
        groups.append(
            {
                "cellId": cell_id,
                "annotationIds": [str(item.get("id")) for item in group_items],
                "variables": _unique_strings(
                    item.get("target", {}).get("variable") for item in group_items
                ),
            }
        )
    return groups


def _unique_strings(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None or value == "":
            continue
        text = str(value)
        if text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result
