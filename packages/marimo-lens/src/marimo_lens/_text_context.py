"""Render standalone text context for Lens selections."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypeVar

from ._control_state import RuntimeControl, SerializedControls
from ._provenance import MAX_TEXT_SOURCE_CHARACTERS, Provenance, ProvenanceCell
from ._runtime import RuntimeSnapshot, notebook_name

MAX_CONTEXT_TEXT_CHARACTERS = 64_000

_TEXT_INTRO_CHARACTERS = 1_900
_TEXT_SELECTION_CHARACTERS = 27_900
_TEXT_CONTROL_CHARACTERS = 7_900
_TEXT_CELL_CHARACTERS = 23_900
_TEXT_LIMIT_CHARACTERS = 1_900
_MAX_NOTEBOOK_PATH = 2_048
_MAX_RUNTIME_REASON = 500

_Item = TypeVar("_Item")


def render_text(
    snapshot: RuntimeSnapshot,
    selections: Sequence[Mapping[str, Any]],
    provenance: Provenance,
    *,
    current_selection_id: str | None,
    serialized_controls: SerializedControls,
    omitted_control_count: int,
) -> str:
    if not selections:
        return "No Lens selections were collected."

    live_cell_ids = {cell.id for cell in snapshot.cells}
    selection_items = [
        (
            {
                **selection,
                "cellStatus": (
                    "unavailable"
                    if not snapshot.available
                    else (
                        "available"
                        if selection["outputCellId"] in live_cell_ids
                        else "missing"
                    )
                ),
            },
            selection,
            selection.get("id") == current_selection_id,
        )
        for selection in selections
    ]

    sections = [
        _render_intro(snapshot),
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


def _render_intro(snapshot: RuntimeSnapshot) -> str:
    lines = [
        "Use the selections below as grounded context for this marimo notebook.",
        "The source, DAG edges, DOM hints, and current controls support a text-only workflow.",
        "Selection PNGs are optional capture-time context when image input is available.",
    ]
    path = _safe_text(snapshot.filename, _MAX_NOTEBOOK_PATH)
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
    if not snapshot.available:
        reason = _safe_text(snapshot.reason, _MAX_RUNTIME_REASON)
        lines.append(
            "- Runtime context: "
            f"{_truncate_text(reason or 'runtime context unavailable', 500)[0]}"
        )
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
    item: tuple[
        Mapping[str, Any],
        Mapping[str, Any],
        bool,
    ],
    quota: int,
) -> tuple[str, bool]:
    selection, source, current = item
    label = str(selection.get("label") or "selection")
    output_cell_id = str(selection.get("outputCellId") or "unknown")
    cell_status = str(selection.get("cellStatus") or "unknown")
    note = str(source.get("note") or "")
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
        note or "none",
        max(1, quota - fixed),
    )
    lines = [header, f"{note_prefix}{note_text}", anchor]
    dom_hint = _dom_hint_text(source.get("domHint"))
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
    return (
        block,
        note_truncated or dom_truncated or snapshot_truncated,
    )


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
    if control.sensitive:
        rendered_value = "[redacted]"
    elif not control.complete:
        rendered_value = "[unavailable]"
    else:
        rendered_value = _json_text(control.value)
    value, value_truncated = _truncate_text(
        rendered_value,
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


__all__ = ["MAX_CONTEXT_TEXT_CHARACTERS", "render_text"]
