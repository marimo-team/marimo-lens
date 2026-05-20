from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

PAIR_FEEDBACK_PROTOCOL = "marimo-pair.feedback"
PAIR_FEEDBACK_VERSION = 1

_PAIR_ACTIONS = {
    "fix": "inspect the target cells, edit the smallest full cell bodies, and run the edited cells",
    "question": "inspect the target cells and answer with the relevant runtime evidence before editing",
    "explain": "inspect the target cells and explain the current behavior from the live graph",
    "approve": "preserve the target behavior; treat this as positive guidance while changing related cells",
}
_SEVERITY_RANK = {"blocking": 0, "important": 1, "suggestion": 2}


def render_markdown(
    annotations: Sequence[Mapping[str, Any]],
    notebook: Mapping[str, Any] | None = None,
) -> str:
    if not annotations:
        return ""
    filename = str((notebook or {}).get("filename") or "marimo notebook")
    lines = [f"## marimo lens feedback: {filename}", ""]
    for index, annotation in enumerate(annotations, start=1):
        target_name = str(
            annotation.get("variable")
            or annotation.get("targetLabel")
            or "unknown target"
        )
        lines.append(f"### {index}. {target_name}")
        lines.append(f"- Intent: `{annotation.get('intent') or 'fix'}`")
        lines.append(f"- Severity: `{annotation.get('severity') or 'important'}`")
        if annotation.get("kind"):
            lines.append(f"- Kind: `{annotation['kind']}`")
        semantic = _semantic_selection(annotation)
        semantic_data = semantic.get("data") if isinstance(semantic, Mapping) else {}
        column = annotation.get("column") or (
            semantic_data.get("column") if isinstance(semantic_data, Mapping) else ""
        )
        column_dtype = annotation.get("columnDtype") or (
            semantic_data.get("columnDtype")
            if isinstance(semantic_data, Mapping)
            else ""
        )
        if column:
            dtype = f" ({column_dtype})" if column_dtype else ""
            lines.append(f"- Column: `{column}`{dtype}")
        chart_part = _chart_part(annotation, semantic)
        if isinstance(chart_part, Mapping):
            part_kind = chart_part.get("kind") or "part"
            part_label = chart_part.get("label") or "unknown"
            library = chart_part.get("library") or "chart"
            lines.append(f"- Chart part: `{library}:{part_kind}` {part_label}")
        if annotation.get("cellId"):
            lines.append(f"- Defining cell: `{annotation['cellId']}`")
        if annotation.get("displayCellId"):
            lines.append(f"- Display cell: `{annotation['displayCellId']}`")
        if annotation.get("kind") == "output" and annotation.get("displayCellId"):
            lines.append(f"- Selected output cell: `{annotation['displayCellId']}`")
        if annotation.get("elementPath"):
            lines.append(f"- DOM: `{annotation['elementPath']}`")
        if semantic:
            lines.append(
                "- Selection: "
                f"`{semantic.get('kind') or 'target'}` "
                f"{semantic.get('label') or ''}".strip()
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
    target_lookup = _target_lookup(targets)
    items = [
        _pair_annotation(index, annotation, graph, target_lookup)
        for index, annotation in enumerate(annotations, start=1)
    ]
    payload = {
        "protocol": PAIR_FEEDBACK_PROTOCOL,
        "version": PAIR_FEEDBACK_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "package": "marimo-lens",
            "title": title,
        },
        "notebook": _pair_notebook(graph),
        "summary": _pair_summary(items, graph),
        "groups": _pair_groups(items),
        "instructions": [
            "Re-discover and inspect the live marimo session before editing; this packet is feedback, not the source of truth.",
            "Use `async with marimo._code_mode.get_context() as ctx:` and call ctx methods synchronously inside the context manager.",
            "Read current cell code from marimo._code_mode ctx.cells because disk may lag the running notebook.",
            "Apply notebook changes with ctx.edit_cell(..., code=<full cell body>) and ctx.run_cell(...); never patch the notebook file directly.",
            "Preserve unrelated cells and use the provided cell ids, variables, refs, and DOM evidence to minimize the edit surface.",
        ],
        "annotations": items,
        "markdown": markdown,
    }
    if metadata:
        payload["extensions"] = dict(metadata)
    return payload


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
        "runtime": graph.get("runtime") or {},
        "cells": graph.get("cells") or [],
        "definitions": graph.get("definitions") or {},
        "edges": graph.get("edges") or [],
        "globals": graph.get("globals") or [],
        "controls": graph.get("controls") or {},
    }


def _target_lookup(
    targets: Sequence[Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    lookup: dict[str, Mapping[str, Any]] = {}
    for target_item in targets:
        target_id = target_item.get("id")
        if target_id:
            lookup[str(target_id)] = target_item
    return lookup


def _pair_annotation(
    index: int,
    annotation: Mapping[str, Any],
    graph: Mapping[str, Any],
    targets: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    target = _annotation_target(annotation, targets)
    variable = target.get("variable") or annotation.get("variable")
    is_output_target = target.get("kind") == "output"
    definition_cell = (
        annotation.get("cellId")
        or target.get("cellId")
        or _first_definition_cell(variable, graph)
    )
    display_cell = annotation.get("displayCellId") or _first_display_cell(
        target,
        definition_cell,
    )
    output_cell = _selected_output_cell(annotation, target, display_cell)
    edit_focus = definition_cell or output_cell
    if is_output_target and output_cell and not display_cell:
        display_cell = output_cell
    downstream = _downstream_cells(edit_focus, graph)
    related_cells = _unique_strings(
        [
            definition_cell,
            display_cell,
            output_cell,
            edit_focus,
            *list(target.get("displayCellIds") or []),
            *list(target.get("relatedCellIds") or []),
            *downstream,
        ]
    )
    severity = str(annotation.get("severity") or "important")
    intent = str(annotation.get("intent") or "fix")
    semantic = _semantic_selection(annotation)
    semantic_data = semantic.get("data") if isinstance(semantic, Mapping) else {}
    column = annotation.get("column") or (
        semantic_data.get("column") if isinstance(semantic_data, Mapping) else ""
    )
    column_dtype = annotation.get("columnDtype") or (
        semantic_data.get("columnDtype") if isinstance(semantic_data, Mapping) else ""
    )
    return {
        "id": annotation.get("id") or f"annotation-{index}",
        "index": index,
        "createdAt": annotation.get("createdAt") or "",
        "severity": severity,
        "intent": intent,
        "request": annotation.get("comment") or "",
        "target": {
            "id": target.get("id") or "",
            "label": target.get("label") or variable or "",
            "variable": variable or "",
            "kind": target.get("kind") or "object",
            "column": column or "",
            "columnDtype": column_dtype or "",
            "chartPart": _chart_part(annotation, semantic),
            "semanticSelection": semantic or None,
            "pythonType": target.get("pythonType") or "",
            "summary": target.get("summary") or "",
            "shape": target.get("shape"),
            "defs": target.get("defs") or [],
            "refs": target.get("refs") or [],
            "output": target.get("output") or {},
            "outputType": target.get("outputType") or "",
            "codePreview": target.get("codePreview") or "",
        },
        "cells": {
            "definition": definition_cell or "",
            "display": display_cell or "",
            "output": output_cell or "",
            "editFocus": edit_focus or "",
            "related": related_cells,
            "downstream": downstream,
            "previews": _cell_previews(related_cells, graph),
        },
        "evidence": {
            "element": annotation.get("element") or "",
            "elementPath": annotation.get("elementPath") or "",
            "semanticSelection": semantic or None,
            "documentPoint": {
                "x": annotation.get("documentX"),
                "y": annotation.get("documentY"),
            },
            "boundingBox": annotation.get("boundingBox") or {},
            "context": annotation.get("context") or {},
        },
        "marimoPair": {
            "recommendedAction": _PAIR_ACTIONS.get(intent, _PAIR_ACTIONS["fix"]),
            "needsClarification": intent == "question",
            "suggestedFocus": _suggested_focus(intent, severity),
            "editGuardrail": "Use marimo._code_mode ctx.edit_cell with the full replacement cell body, then run the edited cell.",
        },
    }


def _annotation_target(
    annotation: Mapping[str, Any],
    targets: Mapping[str, Mapping[str, Any]],
) -> Mapping[str, Any]:
    target_id = annotation.get("targetId")
    if not target_id:
        raise ValueError("Lens annotations require targetId")
    target = targets.get(str(target_id))
    if target is None:
        raise ValueError(
            f"Lens annotation target is not in the current target set: {target_id}"
        )
    return target


def _semantic_selection(annotation: Mapping[str, Any]) -> Mapping[str, Any]:
    semantic = annotation.get("semanticSelection") or (
        (annotation.get("context") or {}).get("semanticSelection")
    )
    return semantic if isinstance(semantic, Mapping) else {}


def _chart_part(
    annotation: Mapping[str, Any],
    semantic: Mapping[str, Any] | None = None,
) -> Any:
    if annotation.get("chartPart"):
        return annotation.get("chartPart")
    context_chart_part = (annotation.get("context") or {}).get("chartPart")
    if context_chart_part:
        return context_chart_part
    data = (semantic or _semantic_selection(annotation)).get("data") or {}
    if isinstance(data, Mapping):
        return data.get("chartPart") or data.get("chartUnit")
    return None


def _first_definition_cell(
    variable: Any,
    graph: Mapping[str, Any],
) -> str | None:
    if not variable:
        return None
    cells = graph.get("definitions", {}).get(str(variable), [])
    ordered_cells = list(cells)
    return str(ordered_cells[0]) if ordered_cells else None


def _first_display_cell(
    target: Mapping[str, Any],
    definition_cell: Any,
) -> str | None:
    for cell_id in target.get("displayCellIds") or []:
        if str(cell_id) != str(definition_cell):
            return str(cell_id)
    return None


def _selected_output_cell(
    annotation: Mapping[str, Any],
    target: Mapping[str, Any],
    display_cell: Any,
) -> str | None:
    if annotation.get("displayCellId"):
        return str(annotation["displayCellId"])
    for cell_id in target.get("displayCellIds") or []:
        return str(cell_id)
    if display_cell:
        return str(display_cell)
    if target.get("kind") == "output" and target.get("cellId"):
        return str(target["cellId"])
    return None


def _downstream_cells(cell_id: Any, graph: Mapping[str, Any]) -> list[str]:
    if not cell_id:
        return []
    return _unique_strings(
        edge.get("to")
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
        "bySeverity": _count_by(items, "severity"),
        "byIntent": _count_by(items, "intent"),
        "targetVariables": _unique_strings(
            item.get("target", {}).get("variable") for item in items
        ),
        "targetCells": _unique_strings(
            cell_id
            for item in items
            for cell_id in item.get("cells", {}).get("related", [])
        ),
        "hasBlocking": any(item.get("severity") == "blocking" for item in items),
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
                "severity": _highest_severity(
                    str(item.get("severity")) for item in group_items
                ),
                "intents": _unique_strings(item.get("intent") for item in group_items),
            }
        )
    return groups


def _count_by(items: Sequence[Mapping[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        value = str(item.get(key) or "unknown")
        counts[value] = counts.get(value, 0) + 1
    return counts


def _highest_severity(values: Iterable[str]) -> str:
    ordered = sorted(values, key=lambda value: _SEVERITY_RANK.get(value, 99))
    return ordered[0] if ordered else "suggestion"


def _suggested_focus(intent: str, severity: str) -> str:
    if severity == "blocking":
        return "resolve before continuing with downstream notebook work"
    if intent == "question":
        return "answer from inspected live notebook state before changing code"
    if intent == "approve":
        return "preserve this behavior while editing adjacent cells"
    return "make the smallest notebook change that satisfies the feedback"


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
