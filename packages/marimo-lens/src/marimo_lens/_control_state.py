"""Capture and serialize bounded state from supported notebook controls."""

from __future__ import annotations

import datetime as dt
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import islice
from typing import Any

MAX_VALUE_ITEMS = 20
MAX_VALUE_DEPTH = 4
MAX_VALUE_STRING = 1_000
MAX_VALUE_NODES = 512
MAX_CONTROLS = 16
MAX_CONTROL_CELL_IDS = 16
MAX_CONTROL_NODES = 512
MAX_CONTROL_CHARACTERS = 8_000


@dataclass(frozen=True, slots=True)
class RuntimeControl:
    name: str
    cell_ids: tuple[str, ...]
    kind: str
    component: str
    label: str
    value: Any
    value_nodes: int = 0
    complete: bool = True
    sensitive: bool = False
    metadata_complete: bool = True


@dataclass(frozen=True, slots=True)
class SerializedControls:
    controls: tuple[RuntimeControl, ...]
    control_complete: tuple[bool, ...]
    state_truncated: bool
    state_complete: bool


@dataclass(slots=True)
class _ValueBudget:
    remaining_nodes: int = MAX_VALUE_NODES
    truncated: bool = False
    opaque: bool = False


def serialize_controls(
    controls: Sequence[RuntimeControl],
) -> SerializedControls:
    """Fit immutable captured controls into the shared context budget."""

    metadata: list[RuntimeControl] = []
    candidate_values: list[Any] = []
    value_complete: list[bool] = []
    used_nodes = 0
    for control in controls:
        captured = _ensure_captured_control(control)
        metadata.append(captured)
        fits_node_budget = used_nodes + captured.value_nodes <= MAX_CONTROL_NODES
        if fits_node_budget:
            used_nodes += captured.value_nodes
            candidate_values.append(captured.value)
        else:
            candidate_values.append(_control_state_node_marker())
        value_complete.append(captured.complete and fits_node_budget)

    values, character_complete = _fit_control_states(candidate_values)
    control_complete = tuple(
        value_is_complete and characters_are_complete
        for value_is_complete, characters_are_complete in zip(
            value_complete,
            character_complete,
            strict=True,
        )
    )
    character_truncated = not all(character_complete)
    serialized = tuple(
        RuntimeControl(
            name=control.name,
            cell_ids=control.cell_ids,
            kind=control.kind,
            component=control.component,
            label=control.label,
            value=value,
            value_nodes=control.value_nodes,
            complete=complete,
            sensitive=control.sensitive,
            metadata_complete=control.metadata_complete,
        )
        for control, value, complete in zip(
            metadata,
            values,
            control_complete,
            strict=True,
        )
    )
    return SerializedControls(
        controls=serialized,
        control_complete=control_complete,
        state_truncated=(
            not all(control_complete)
            or character_truncated
            or any(not control.metadata_complete for control in metadata)
        ),
        state_complete=all(control_complete),
    )


def _ensure_captured_control(control: RuntimeControl) -> RuntimeControl:
    budget = _ValueBudget(remaining_nodes=MAX_CONTROL_NODES)
    safe_value = _safe_value(control.value, budget=budget)
    metadata_complete = _identity_is_complete(
        control.component
    ) and _identity_is_complete(control.label)
    return RuntimeControl(
        name=control.name,
        cell_ids=control.cell_ids,
        kind=control.kind,
        component=_identity_text(control.component, fallback="unknown"),
        label=_identity_text(control.label, fallback="", allow_empty=True),
        value=None if control.sensitive else safe_value,
        value_nodes=MAX_CONTROL_NODES - budget.remaining_nodes,
        complete=control.complete and not budget.truncated and not budget.opaque,
        sensitive=control.sensitive,
        metadata_complete=control.metadata_complete and metadata_complete,
    )


def _safe_value(
    value: Any,
    *,
    depth: int = 0,
    ancestors: set[int] | None = None,
    budget: _ValueBudget | None = None,
) -> Any:
    budget = _ValueBudget() if budget is None else budget
    if budget.remaining_nodes <= 0:
        budget.truncated = True
        return {"truncated": "value node budget reached"}
    budget.remaining_nodes -= 1

    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value.bit_length() > 4_096:
            budget.truncated = True
            return {
                "type": _bounded_text(_type_name(value), budget),
                "truncated": "integer bit limit reached",
            }
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        budget.opaque = True
        return {"type": "float", "repr": repr(value)}
    if isinstance(value, str):
        return _bounded_text(value, budget)
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, (dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        budget.opaque = True
        byte_count = value.nbytes if isinstance(value, memoryview) else len(value)
        return {"type": type(value).__name__, "bytes": byte_count}
    if depth >= MAX_VALUE_DEPTH:
        budget.truncated = True
        return {
            "type": _bounded_text(_type_name(value), budget),
            "truncated": "maximum value depth reached",
        }

    ancestors = set() if ancestors is None else ancestors
    marker = id(value)
    if marker in ancestors:
        budget.opaque = True
        return {
            "type": _bounded_text(_type_name(value), budget),
            "cycle": True,
        }
    ancestors.add(marker)
    try:
        if isinstance(value, Mapping):
            try:
                keys = list(islice(iter(value), MAX_VALUE_ITEMS + 1))
            except Exception:
                return _describe(value, budget)
            keyed: list[tuple[str, Any]] = []
            for key in keys[:MAX_VALUE_ITEMS]:
                try:
                    safe_key = _bounded_text(str(key), budget)
                except Exception:
                    budget.opaque = True
                    safe_key = _bounded_text(_type_name(key), budget)
                if not isinstance(key, str):
                    budget.opaque = True
                keyed.append((safe_key, key))
            keyed.sort(key=lambda item: item[0])
            mapping_result: dict[str, Any] = {}
            for safe_key, key in keyed:
                if budget.remaining_nodes <= 0:
                    budget.truncated = True
                    break
                try:
                    item = value[key]
                except Exception:
                    budget.opaque = True
                    continue
                if safe_key in mapping_result:
                    budget.opaque = True
                mapping_result[safe_key] = _safe_value(
                    item,
                    depth=depth + 1,
                    ancestors=ancestors,
                    budget=budget,
                )
            if len(keys) > MAX_VALUE_ITEMS or budget.remaining_nodes <= 0:
                budget.truncated = True
                mapping_result["..."] = "more items omitted"
            return mapping_result
        if isinstance(value, (list, tuple, set, frozenset)):
            if isinstance(value, (set, frozenset)):
                budget.opaque = True
            try:
                items = list(islice(iter(value), MAX_VALUE_ITEMS + 1))
            except Exception:
                return _describe(value, budget)
            sequence_result: list[Any] = []
            for item in items[:MAX_VALUE_ITEMS]:
                if budget.remaining_nodes <= 0:
                    budget.truncated = True
                    break
                sequence_result.append(
                    _safe_value(
                        item,
                        depth=depth + 1,
                        ancestors=ancestors,
                        budget=budget,
                    )
                )
            if len(items) > MAX_VALUE_ITEMS or budget.remaining_nodes <= 0:
                budget.truncated = True
                sequence_result.append("... more items omitted")
            if isinstance(value, (set, frozenset)):
                sequence_result.sort(key=_canonical_json)
            return sequence_result
        return _describe(value, budget)
    finally:
        ancestors.remove(marker)


def _describe(value: Any, budget: _ValueBudget) -> dict[str, str]:
    budget.opaque = True
    return {"type": _bounded_text(_type_name(value), budget)}


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _bounded_text(value: str, budget: _ValueBudget) -> str:
    result, truncated = _bounded_unicode(value)
    if truncated:
        budget.truncated = True
    return result


def _identity_text(
    value: str,
    *,
    fallback: str,
    allow_empty: bool = False,
) -> str:
    result, _truncated = _bounded_unicode(value)
    if result or allow_empty:
        return result
    return fallback


def _identity_is_complete(value: str) -> bool:
    return len(value) <= MAX_VALUE_STRING and all(
        not 0xD800 <= ord(character) <= 0xDFFF for character in value
    )


def _bounded_unicode(value: str) -> tuple[str, bool]:
    truncated = len(value) > MAX_VALUE_STRING
    raw = value[: MAX_VALUE_STRING - 3] + "..." if truncated else value
    replaced = any(0xD800 <= ord(character) <= 0xDFFF for character in raw)
    return (
        "".join(
            "\N{REPLACEMENT CHARACTER}"
            if 0xD800 <= ord(character) <= 0xDFFF
            else character
            for character in raw
        ),
        truncated or replaced,
    )


def _fit_control_states(
    values: Sequence[Any],
) -> tuple[tuple[Any, ...], tuple[bool, ...]]:
    marker = _control_state_character_marker()
    marker_characters = _json_characters(marker)
    total_characters = 2 + max(0, len(values) - 1) + marker_characters * len(values)
    if total_characters > MAX_CONTROL_CHARACTERS:
        raise RuntimeError("Control state markers exceed the serialization budget.")

    result: list[Any] = []
    complete: list[bool] = []
    for value in values:
        value_characters = _json_characters(value)
        if (
            total_characters - marker_characters + value_characters
            <= MAX_CONTROL_CHARACTERS
        ):
            result.append(value)
            complete.append(True)
            total_characters += value_characters - marker_characters
        else:
            result.append(_control_state_character_marker())
            complete.append(False)

    serialized = tuple(result)
    exact_characters = _json_characters(serialized)
    if (
        exact_characters != total_characters
        or exact_characters > MAX_CONTROL_CHARACTERS
    ):
        raise RuntimeError("Control state serialization exceeded its budget.")
    return serialized, tuple(complete)


def _control_state_character_marker() -> dict[str, str]:
    return {"truncated": "control state character budget reached"}


def _control_state_node_marker() -> dict[str, str]:
    return {"truncated": "control state node budget reached"}


def _json_characters(value: Any) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    )


def _type_name(value: Any) -> str:
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


__all__ = [
    "MAX_CONTROL_CHARACTERS",
    "MAX_CONTROLS",
    "RuntimeControl",
    "SerializedControls",
    "serialize_controls",
]
