from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from ._target_payload import python_type_name

MAX_CONTEXT_ITEMS = 80
MAX_VALUE_ITEMS = 20
MAX_VALUE_DEPTH = 4
MAX_STRING = 500


def safe_value(value: Any, *, depth: int = 0) -> Any:
    """Return a bounded, JSON-friendly value without masking user data."""

    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:MAX_STRING] + ("..." if len(value) > MAX_STRING else "")
    if depth >= MAX_VALUE_DEPTH:
        return describe_value(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"type": type(value).__name__, "bytes": len(value)}
    if isinstance(value, Mapping):
        items = list(value.items())
        result = {
            str(item_key): safe_value(item_value, depth=depth + 1)
            for item_key, item_value in items[:MAX_VALUE_ITEMS]
        }
        if len(items) > MAX_VALUE_ITEMS:
            result["..."] = f"{len(items) - MAX_VALUE_ITEMS} more"
        return result
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        result = [safe_value(item, depth=depth + 1) for item in items[:MAX_VALUE_ITEMS]]
        if len(items) > MAX_VALUE_ITEMS:
            result.append(f"... {len(items) - MAX_VALUE_ITEMS} more")
        return result
    return describe_value(value)


def context_policy() -> dict[str, Any]:
    """Describe how Lens bounds context without redacting notebook data."""

    return {
        "redaction": "none",
        "trustedLocalNotebook": True,
        "trustedLocalMachine": True,
        "bounds": {
            "maxContextItems": MAX_CONTEXT_ITEMS,
            "maxValueItems": MAX_VALUE_ITEMS,
            "maxValueDepth": MAX_VALUE_DEPTH,
            "maxString": MAX_STRING,
        },
    }


def safe_argv(argv: Iterable[Any]) -> list[Any]:
    """Return bounded, JSON-friendly argv values."""

    return [safe_value(str(raw)) for raw in argv]


def describe_value(value: Any) -> dict[str, str]:
    return {
        "type": python_type_name(value),
        "repr": repr(value)[:MAX_STRING],
    }


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Mapping):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray, str)):
        return [jsonable(v) for v in value]
    return str(value)


def preview(code: str, limit: int = 180) -> str:
    single_line = " ".join(code.strip().split())
    return single_line[:limit] + ("..." if len(single_line) > limit else "")
