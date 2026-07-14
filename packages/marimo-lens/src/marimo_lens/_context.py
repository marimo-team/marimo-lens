"""Build live selection references and standalone text context."""

from __future__ import annotations

import copy
import json
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, TypeVar

from ._provenance import (
    MAX_TEXT_SOURCE_CHARACTERS,
    Provenance,
    ProvenanceCell,
    resolve_provenance,
)
from ._runtime import (
    MAX_CONTROLS,
    RuntimeControl,
    RuntimeSnapshot,
    SerializedControls,
    notebook_name,
    serialize_controls,
)

CONTEXT_PROTOCOL = "marimo-lens.context"
CONTEXT_VERSION = 1

# The browser state limit keeps synchronized selections and live references
# small. Text sections have independent budgets so adversarial runtime metadata
# cannot consume the model context window.
MAX_SELECTION_STATE_BYTES = 40_000
MAX_CONTEXT_REFERENCES_BYTES = 45_000
MAX_CONTEXT_TEXT_CHARACTERS = 64_000

_MAX_NOTEBOOK_PATH = 2_048
_MAX_RUNTIME_REASON = 500
_TEXT_INTRO_CHARACTERS = 1_900
_TEXT_SELECTION_CHARACTERS = 27_900
_TEXT_CONTROL_CHARACTERS = 7_900
_TEXT_CELL_CHARACTERS = 23_900
_TEXT_LIMIT_CHARACTERS = 1_900

_Item = TypeVar("_Item")


def build_context(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> tuple[dict[str, Any], str]:
    """Build live references and standalone text from one runtime snapshot."""

    validate_selection_budget(selections)
    output_cell_ids = [str(selection["outputCellId"]) for selection in selections]
    provenance = resolve_provenance(snapshot, output_cell_ids)
    relevant_controls = _rank_relevant_controls(
        snapshot,
        provenance,
        output_cell_ids,
    )
    serialized_controls = serialize_controls(relevant_controls[:MAX_CONTROLS])
    omitted_control_count = max(
        0,
        len(relevant_controls) - len(serialized_controls.controls),
    )
    references = _build_references(
        snapshot,
        selections,
        revision=revision,
        current_selection_id=current_selection_id,
    )
    text = _render_text(
        references,
        selections,
        provenance,
        serialized_controls=serialized_controls,
        omitted_control_count=omitted_control_count,
    )
    return references, text


def validate_selection_budget(
    selections: Sequence[Mapping[str, Any]],
) -> None:
    """Reject selection state that would create an oversized handoff."""

    size = len(
        json.dumps(
            list(selections),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    if size > MAX_SELECTION_STATE_BYTES:
        raise ValueError(
            "Lens selection notes and DOM evidence exceed the shared "
            f"{MAX_SELECTION_STATE_BYTES:,}-byte limit."
        )


def _rank_relevant_controls(
    snapshot: RuntimeSnapshot,
    provenance: Provenance,
    output_cell_ids: Sequence[str],
) -> list[RuntimeControl]:
    output_id_set = set(output_cell_ids)
    distances = _upstream_distances(snapshot, output_cell_ids)
    cells_by_id = {cell.id: cell for cell in snapshot.cells}
    ranked: list[tuple[tuple[int, int, int], RuntimeControl]] = []
    fallback = len(snapshot.cells) + 1

    for runtime_order, control in enumerate(snapshot.controls):
        direct = bool(output_id_set.intersection(control.cell_ids))
        if not direct and control.name not in provenance.referenced_names:
            continue
        reference_distance = min(
            (
                distance
                for cell_id, distance in distances.items()
                if control.name in cells_by_id[cell_id].refs
            ),
            default=fallback,
        )
        rank = (0 if direct else 1, reference_distance, runtime_order)
        ranked.append((rank, control))

    ranked.sort(key=lambda item: item[0])
    return [control for _rank, control in ranked]


def _upstream_distances(
    snapshot: RuntimeSnapshot,
    output_cell_ids: Sequence[str],
) -> dict[str, int]:
    cells_by_id = {cell.id: cell for cell in snapshot.cells}
    distances: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque(
        (cell_id, 0) for cell_id in output_cell_ids if cell_id in cells_by_id
    )
    while queue:
        cell_id, distance = queue.popleft()
        previous = distances.get(cell_id)
        if previous is not None and previous <= distance:
            continue
        distances[cell_id] = distance
        queue.extend(
            (parent_id, distance + 1)
            for parent_id in cells_by_id[cell_id].upstream_cell_ids
            if parent_id in cells_by_id
        )
    return distances


def _build_references(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    *,
    revision: int,
    current_selection_id: str | None,
) -> dict[str, Any]:
    live_cell_ids = {cell.id for cell in snapshot.cells}
    selection_references = [
        _project_selection(
            selection,
            cell_status=(
                "unavailable"
                if not snapshot.available
                else (
                    "available"
                    if selection["outputCellId"] in live_cell_ids
                    else "missing"
                )
            ),
        )
        for selection in selections
    ]

    notebook: dict[str, Any] = {
        "path": _safe_text(snapshot.filename, _MAX_NOTEBOOK_PATH),
        "available": snapshot.available,
    }
    if not snapshot.available:
        notebook["reason"] = _safe_text(snapshot.reason, _MAX_RUNTIME_REASON)

    references = {
        "protocol": CONTEXT_PROTOCOL,
        "version": CONTEXT_VERSION,
        "revision": revision,
        "generatedAt": _utcnow(),
        "notebook": notebook,
        "currentSelectionId": current_selection_id,
        "selections": selection_references,
    }
    reference_size = len(
        json.dumps(
            references,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    if reference_size > MAX_CONTEXT_REFERENCES_BYTES:
        raise RuntimeError(
            "Lens context references exceeded their serialization budget."
        )
    return references


def _project_selection(
    selection: Mapping[str, Any],
    *,
    cell_status: str,
) -> dict[str, Any]:
    snapshot = selection.get("snapshot")
    if not isinstance(snapshot, Mapping) or snapshot.get("status") not in {
        "pending",
        "available",
        "failed",
        "outdated",
    }:
        raise RuntimeError("Selection snapshot status is invalid.")
    snapshot_status = str(snapshot["status"])
    item: dict[str, Any] = {
        "id": str(selection["id"]),
        "label": str(selection["label"]),
        "note": str(selection["note"]),
        "outputCellId": str(selection["outputCellId"]),
        "cellStatus": cell_status,
        "anchor": copy.deepcopy(selection["anchor"]),
        "snapshot": {"status": snapshot_status},
    }
    dom_hint = selection.get("domHint")
    if isinstance(dom_hint, Mapping):
        item["domHint"] = copy.deepcopy(dict(dom_hint))
    return item


def _render_text(
    references: Mapping[str, Any],
    source_selections: Sequence[Mapping[str, Any]],
    provenance: Provenance,
    *,
    serialized_controls: SerializedControls,
    omitted_control_count: int,
) -> str:
    selections = references.get("selections")
    if not isinstance(selections, list) or not selections:
        return "No marimo Lens selections were collected."

    source_by_id = {
        str(selection.get("id")): selection for selection in source_selections
    }
    selection_items = [
        (
            selection,
            source_by_id.get(str(selection.get("id")), selection),
            selection.get("id") == references.get("currentSelectionId"),
        )
        for selection in selections
        if isinstance(selection, Mapping)
    ]

    sections = [
        _render_intro(references),
        _fair_section(
            "## Selections",
            selection_items,
            budget=_TEXT_SELECTION_CHARACTERS,
            render=_render_selection_block,
            notice=(
                "Context note: Some selection notes or DOM hints were "
                "truncated by the total text budget."
            ),
        ),
        _fair_section(
            "## Current controls",
            serialized_controls.controls,
            budget=_TEXT_CONTROL_CHARACTERS,
            render=_render_control_block,
            notice=(
                "Context note: Some control metadata or values were truncated "
                "by the total text budget."
            ),
        ),
        _fair_section(
            (
                "## Relevant cells\n"
                "Cells are in topological order. Upstream IDs name direct DAG parents."
            ),
            provenance.cells,
            budget=_TEXT_CELL_CHARACTERS,
            render=_render_cell_block,
            notice=(
                "Context note: Some cell metadata or source was truncated by "
                "the total text budget."
            ),
        ),
        _render_context_limits(
            provenance,
            omitted_control_count=omitted_control_count,
            control_state_truncated=serialized_controls.state_truncated,
        ),
    ]
    text = "\n\n".join(section for section in sections if section)
    if len(text) > MAX_CONTEXT_TEXT_CHARACTERS:
        raise RuntimeError("Lens context text exceeded its rendering budget.")
    return text


def _render_intro(references: Mapping[str, Any]) -> str:
    lines = [
        "Use the selections below as grounded context for this marimo notebook.",
        "The source, DAG edges, DOM hints, and current controls support a text-only workflow.",
        "Selection PNGs are optional capture-time context when image input is available.",
    ]
    notebook = references.get("notebook")
    if isinstance(notebook, Mapping):
        path = str(notebook.get("path") or "")
        name = notebook_name(path) or "unknown notebook"
        lines.extend(
            [
                "",
                "## Notebook",
                f"- Name: `{_truncate_text(name, 256)[0]}`",
            ]
        )
        if path:
            lines.append(f"- Path: `{_truncate_text(path, 900)[0]}`")
        if notebook.get("available") is False:
            reason = str(notebook.get("reason") or "runtime context unavailable")
            lines.append(f"- Runtime context: {_truncate_text(reason, 500)[0]}")
    rendered = "\n".join(lines)
    return _truncate_text(rendered, _TEXT_INTRO_CHARACTERS)[0]


def _fair_section(
    header: str,
    items: Sequence[_Item],
    *,
    budget: int,
    render: Callable[[_Item, int], tuple[str, bool]],
    notice: str,
) -> str:
    if not items:
        return ""
    separator_characters = 2 * (len(items) + 1)
    available = budget - len(header) - len(notice) - separator_characters
    quota = max(1, available // len(items))
    blocks: list[str] = []
    truncated = False
    for item in items:
        block, item_truncated = render(item, quota)
        if len(block) > quota:
            raise RuntimeError("Lens context text block exceeded its section budget.")
        blocks.append(block)
        truncated = truncated or item_truncated
    parts = [header]
    if truncated:
        parts.append(notice)
    parts.extend(blocks)
    section = "\n\n".join(parts)
    if len(section) > budget:
        raise RuntimeError("Lens context text section exceeded its rendering budget.")
    return section


def _render_selection_block(
    item: tuple[Mapping[str, Any], Mapping[str, Any], bool],
    quota: int,
) -> tuple[str, bool]:
    selection, source, current = item
    label = str(selection.get("label") or "selection")
    output_cell_id = str(selection.get("outputCellId") or "unknown")
    cell_status = str(selection.get("cellStatus") or "unknown")
    note = str(selection.get("note") or "")
    snapshot_text, snapshot_truncated = _snapshot_text(
        source.get("snapshot"), maximum=120
    )
    current_text = " (current)" if current else ""
    header = (
        f"### {label}{current_text} on output cell `{output_cell_id}` ({cell_status})"
    )
    anchor = f"- Attention: {_anchor_text(selection.get('anchor'))}"
    snapshot = f"- Snapshot: {snapshot_text}"
    note_prefix = "- Note: "
    fixed = len("\n".join((header, note_prefix, anchor, snapshot)))
    note_text, note_truncated = _truncate_text(
        note,
        max(1, quota - fixed),
    )
    lines = [header, f"{note_prefix}{note_text or 'none'}", anchor]
    dom_hint = _dom_hint_text(selection.get("domHint"))
    dom_truncated = False
    base_with_snapshot = "\n".join((*lines, snapshot))
    if dom_hint:
        prefix = "- DOM hint: "
        remaining = quota - len(base_with_snapshot) - len(prefix) - 1
        if remaining > 3:
            shown, dom_truncated = _truncate_text(dom_hint, remaining)
            lines.append(f"{prefix}{shown}")
        else:
            dom_truncated = True
    lines.append(snapshot)
    block = "\n".join(lines)
    if len(block) > quota:
        raise RuntimeError("Selection block cannot fit its text quota.")
    return block, note_truncated or dom_truncated or snapshot_truncated


def _render_control_block(
    control: RuntimeControl,
    quota: int,
) -> tuple[str, bool]:
    name, name_truncated = _truncate_text(control.name, 100)
    component, component_truncated = _truncate_text(control.component, 100)
    label, label_truncated = _truncate_text(control.label, 100)
    value_key = "state" if control.kind == "anywidget" else "value"
    label_json, label_json_truncated = _truncate_text(
        json.dumps(label, ensure_ascii=False),
        100,
    )
    label_text = f", label {label_json}" if label else ""
    prefix = f"- `{name}` ({component}{label_text}) {value_key}: "
    value, value_truncated = _truncate_text(
        _json_text(control.value),
        max(1, quota - len(prefix)),
    )
    line = f"{prefix}{value}"
    if len(line) > quota:
        raise RuntimeError("Control block cannot fit its text quota.")
    return (
        line,
        name_truncated
        or component_truncated
        or label_truncated
        or label_json_truncated
        or value_truncated,
    )


def _render_cell_block(
    item: ProvenanceCell,
    quota: int,
) -> tuple[str, bool]:
    cell = item.cell
    roles = ", ".join(item.roles)
    header = f"### Cell `{cell.id}` ({roles})"
    metadata_budget = max(20, min(100, (quota - len(header) - 80) // 3))
    defs, defs_truncated = _names_text(cell.defs, maximum=metadata_budget)
    refs, refs_truncated = _names_text(cell.refs, maximum=metadata_budget)
    parents, parents_truncated = _names_text(
        cell.upstream_cell_ids,
        maximum=metadata_budget,
    )
    prefix = "\n".join(
        (
            header,
            f"- Defines: {defs}",
            f"- References: {refs}",
            f"- Upstream IDs: {parents}",
        )
    )
    language = _fence_language(cell.language)
    code = item.code
    source_truncated = False
    while True:
        fence = _code_fence(code)
        block = f"{prefix}\n{fence}{language}\n{code}\n{fence}"
        if len(block) <= quota:
            break
        overflow = len(block) - quota
        next_length = max(0, len(code) - overflow - 3)
        if next_length >= len(code):
            next_length = max(0, len(code) - 1)
        code = code[:next_length]
        source_truncated = True
        if not code:
            fence = "```"
            block = f"{prefix}\n{fence}{language}\n\n{fence}"
            if len(block) > quota:
                raise RuntimeError("Cell metadata cannot fit its text quota.")
            break
    return (
        block,
        source_truncated or defs_truncated or refs_truncated or parents_truncated,
    )


def _render_context_limits(
    provenance: Provenance,
    *,
    omitted_control_count: int,
    control_state_truncated: bool,
) -> str:
    lines = _context_limit_lines(
        provenance,
        omitted_control_count=omitted_control_count,
        control_state_truncated=control_state_truncated,
    )
    if not lines:
        return ""
    rendered = "\n".join(("## Context limits", *lines))
    return _truncate_text(rendered, _TEXT_LIMIT_CHARACTERS)[0]


def _context_limit_lines(
    provenance: Provenance,
    *,
    omitted_control_count: int,
    control_state_truncated: bool,
) -> list[str]:
    lines: list[str] = []
    if provenance.omitted_cell_count:
        omitted, _truncated = _names_text(
            provenance.omitted_cell_ids,
            maximum=900,
        )
        lines.append(
            f"- {provenance.omitted_cell_count} upstream cells were omitted. "
            f"First omitted IDs: {omitted}."
        )
    if provenance.truncated_cell_ids:
        truncated, _names_truncated = _names_text(
            provenance.truncated_cell_ids,
            maximum=900,
        )
        lines.append(
            f"- Source was truncated for {truncated} at the shared "
            f"{MAX_TEXT_SOURCE_CHARACTERS:,}-character source budget."
        )
    if omitted_control_count:
        lines.append(f"- {omitted_control_count} relevant controls were omitted.")
    if control_state_truncated:
        lines.append("- Current control state was truncated by its shared text budget.")
    return lines


def _anchor_text(value: object) -> str:
    if not isinstance(value, Mapping):
        return "unknown"
    kind = str(value.get("kind") or "unknown")
    if kind == "rect":
        return (
            "rectangle "
            f"x={_number(value.get('x'))}, y={_number(value.get('y'))}, "
            f"width={_number(value.get('width'))}, height={_number(value.get('height'))}"
        )
    return f"point x={_number(value.get('x'))}, y={_number(value.get('y'))}"


def _dom_hint_text(value: object) -> str:
    if not isinstance(value, Mapping):
        return ""
    parts: list[str] = []
    for key, label in (
        ("tag", "tag"),
        ("role", "role"),
        ("ariaLabel", "accessible label"),
        ("title", "title"),
        ("text", "text"),
        ("path", "path"),
    ):
        field = value.get(key)
        if isinstance(field, str) and field:
            parts.append(f"{label}={json.dumps(field, ensure_ascii=False)}")
    bounds = value.get("bounds")
    if isinstance(bounds, Mapping):
        parts.append(
            "bounds=("
            f"x={_number(bounds.get('x'))}, y={_number(bounds.get('y'))}, "
            f"width={_number(bounds.get('width'))}, height={_number(bounds.get('height'))}"
            ")"
        )
    return ", ".join(parts)


def _snapshot_text(value: object, *, maximum: int) -> tuple[str, bool]:
    if not isinstance(value, Mapping):
        raise RuntimeError("Selection snapshot metadata is invalid.")
    status = str(value.get("status") or "")
    if status == "available":
        text = f"available ({value.get('width')}x{value.get('height')} PNG)"
    elif status == "outdated":
        text = f"outdated ({value.get('width')}x{value.get('height')} PNG)"
    elif status == "pending":
        text = "pending"
    elif status == "failed":
        error = str(value.get("error") or "visual capture failed")
        text = f"failed ({error})"
    else:
        raise RuntimeError("Selection snapshot status is invalid.")
    return _truncate_text(text, maximum)


def _names_text(
    values: Sequence[str],
    *,
    maximum: int,
) -> tuple[str, bool]:
    if not values:
        return "none", False
    result: list[str] = []
    length = 0
    for value in values:
        token = f"`{value}`"
        separator = ", " if result else ""
        if length + len(separator) + len(token) <= maximum:
            result.append(token)
            length += len(separator) + len(token)
            continue
        marker = ", ..." if result else "..."
        if result and length + len(marker) <= maximum:
            return "".join((", ".join(result), marker)), True
        shown, _truncated = _truncate_text(token, maximum)
        return shown, True
    return ", ".join(result), False


def _json_text(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )


def _truncate_text(value: str, maximum: int) -> tuple[str, bool]:
    if len(value) <= maximum:
        return value, False
    if maximum <= 3:
        return "." * max(0, maximum), True
    return value[: maximum - 3] + "...", True


def _safe_text(value: str, maximum: int) -> str:
    sanitized = "".join(
        "\N{REPLACEMENT CHARACTER}" if 0xD800 <= ord(character) <= 0xDFFF else character
        for character in value
    )
    if len(sanitized.encode("utf-8")) <= maximum:
        return sanitized
    result: list[str] = []
    size = 0
    for character in sanitized:
        width = len(character.encode("utf-8"))
        if size + width > maximum - 3:
            break
        result.append(character)
        size += width
    return "".join(result) + "..."


def _number(value: object) -> str:
    return f"{value:.4f}" if isinstance(value, (int, float)) else "unknown"


def _fence_language(value: str) -> str:
    return value if value.replace("-", "").replace("_", "").isalnum() else "text"


def _code_fence(code: str) -> str:
    backticks = _longest_run(code, "`")
    tildes = _longest_run(code, "~")
    character, run = ("`", backticks) if backticks <= tildes else ("~", tildes)
    return character * max(3, run + 1)


def _longest_run(value: str, character: str) -> int:
    longest = 0
    current = 0
    for item in value:
        if item == character:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = ["build_context"]
