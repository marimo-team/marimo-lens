"""Shared chart metadata helpers for visualization adapters."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..._serialization import MAX_VALUE_ITEMS, preview, safe_value

VALID_CHART_PART_KINDS = frozenset(
    {
        "annotation",
        "axis",
        "legend",
        "mark",
        "plot-area",
        "title",
        "trace",
    }
)


@dataclass(frozen=True)
class ChartMetadata:
    """Typed chart metadata returned by custom chart adapters."""

    parts: Sequence[Mapping[str, Any]] = ()
    library: str | None = None
    renderer: str | None = None
    mark: Any | None = None
    encoding: Mapping[str, Any] | None = None
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {}
        if self.library:
            metadata["library"] = self.library
        if self.renderer:
            metadata["renderer"] = self.renderer
        if self.mark is not None:
            metadata["mark"] = safe_value(self.mark)
        if self.encoding is not None:
            metadata["encoding"] = safe_value(self.encoding)
        if self.parts:
            metadata["parts"] = [dict(part) for part in self.parts]
        if self.extensions:
            metadata["extensions"] = safe_value(dict(self.extensions))
        return metadata


def chart_library(value: Any, *, is_svg_html: bool = False) -> str | None:
    module = type(value).__module__.lower()
    qualname = type(value).__qualname__.lower()
    type_name = f"{module}.{qualname}"
    if "altair" in module or "vegalite" in module:
        return "altair"
    if "plotly" in module:
        return "plotly"
    if "matplotlib" in module:
        return "matplotlib"
    if "bokeh" in module:
        return "visual"
    if is_svg_html:
        return "visual"
    if hasattr(value, "to_dict") and "chart" in type_name:
        return "visual"
    return None


def call_chart_method(value: Any, method_name: str) -> Mapping[str, Any]:
    method = getattr(value, method_name)
    try:
        result = method()
    except TypeError:
        result = method(validate=False)
    return result if isinstance(result, Mapping) else {}


def call_optional(value: Any, method_name: str) -> Any:
    method = getattr(value, method_name, None)
    if method is None:
        return None
    try:
        return method()
    except Exception:
        return None


def axis_title(value: Any) -> str:
    if isinstance(value, Mapping):
        text = value.get("text") or value.get("title")
        return str(text) if text else ""
    return str(value) if value else ""


def field_label(value: Any) -> str:
    if isinstance(value, Mapping):
        field = value.get("field") or value.get("shorthand") or value.get("datum")
        return str(field) if field else ""
    return str(value) if value else ""


def chart_part(
    kind: str,
    label: str,
    detail: str | None = None,
    *,
    id: str | None = None,
    channel: str | None = None,
    field: str | None = None,
    orientation: str | None = None,
    selector: str | None = None,
    datum: Mapping[str, Any] | None = None,
    context: Mapping[str, Any] | None = None,
    **extensions: Any,
) -> dict[str, Any]:
    """Return a bounded, JSON-safe chart unit descriptor."""

    kind = str(kind)
    if kind not in VALID_CHART_PART_KINDS:
        valid = ", ".join(sorted(VALID_CHART_PART_KINDS))
        raise ValueError(f"Chart part kind must be one of: {valid}")
    part: dict[str, Any] = {
        "kind": kind,
        "label": preview(str(label), 80),
    }
    if detail:
        part["detail"] = preview(str(detail), 120)
    if id:
        part["id"] = preview(str(id), 120)
    if channel:
        part["channel"] = preview(str(channel), 80)
    if field:
        part["field"] = preview(str(field), 120)
    if orientation:
        part["orientation"] = preview(str(orientation), 40)
    if selector:
        part["selector"] = preview(str(selector), 500)
    if datum:
        part["datum"] = safe_value(dict(datum))
    if context:
        part["context"] = safe_value(dict(context))
    if extensions:
        part["extensions"] = safe_value(extensions)
    return part


def dedupe_chart_parts(parts: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for part in parts:
        key = (
            str(part.get("kind") or ""),
            str(part.get("label") or ""),
            str(part.get("detail") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(dict(part))
        if len(unique) >= MAX_VALUE_ITEMS:
            break
    return unique


def with_chart_library(
    library: str,
    parts: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    return [{**dict(part), "library": library} for part in parts]
