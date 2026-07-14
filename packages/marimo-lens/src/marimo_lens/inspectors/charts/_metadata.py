"""Shared chart metadata helpers for visualization adapters."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..._contract import CHART_PART_KINDS as VALID_CHART_PART_KINDS
from ..._serialization import MAX_VALUE_ITEMS, preview, safe_value

_CHART_LIBRARY_RULES = (
    ("altair", "altair"),
    ("vegalite", "altair"),
    ("plotly", "plotly"),
    ("matplotlib", "matplotlib"),
    ("bokeh", "visual"),
)
_AXIS_CHANNELS = frozenset(("x", "x2", "y", "y2"))
_LEGEND_CHANNELS = frozenset(("color", "fill", "shape", "size", "stroke"))
_FACET_CHANNELS = ("column", "row", "facet")


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
    for marker, library in _CHART_LIBRARY_RULES:
        if marker in module:
            return library
    if is_svg_html:
        return "visual"
    if hasattr(value, "to_dict") and "chart" in type_name:
        return "visual"
    return None


def call_chart_method(value: Any, method_name: str) -> Mapping[str, Any] | None:
    method = getattr(value, method_name)
    try:
        result = method()
    except Exception:
        try:
            result = method(validate=False)
        except Exception:
            return None
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
        if isinstance(text, Mapping):
            return axis_title(text)
        return str(text) if text else ""
    return str(value) if value else ""


def title_text(value: Any) -> str:
    if isinstance(value, Mapping):
        text = value.get("text") or value.get("title")
        if isinstance(text, Mapping):
            return title_text(text)
        if isinstance(text, Sequence) and not isinstance(text, (str, bytes, bytearray)):
            return " ".join(str(item) for item in text if item)
        return str(text) if text else ""
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return " ".join(str(item) for item in value if item)
    return str(value) if value else ""


def field_label(
    value: Any, repeat_context: Mapping[str, Sequence[str]] | None = None
) -> str:
    labels = field_labels(value, repeat_context=repeat_context)
    return labels[0] if labels else ""


def field_labels(
    value: Any,
    *,
    repeat_context: Mapping[str, Sequence[str]] | None = None,
) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, Mapping):
        field = value.get("field") or value.get("shorthand") or value.get("datum")
        if isinstance(field, Mapping):
            return field_labels(field, repeat_context=repeat_context)
        if isinstance(field, str) and field:
            return [field]
        repeat_key = value.get("repeat")
        if isinstance(repeat_key, str) and repeat_key:
            repeated = (repeat_context or {}).get(repeat_key)
            return list(repeated) if repeated else [repeat_key]
        labels: list[str] = []
        for key in ("row", "column", "tooltip", "facet"):
            labels.extend(field_labels(value.get(key), repeat_context=repeat_context))
        return ordered_unique(labels)
    if isinstance(value, Iterable) and not isinstance(
        value, (str, bytes, bytearray, Mapping)
    ):
        labels: list[str] = []
        for item in value:
            labels.extend(field_labels(item, repeat_context=repeat_context))
        return ordered_unique(labels)
    return []


def mark_label(mark: Any) -> str:
    if isinstance(mark, Mapping):
        return str(mark.get("type") or "mark")
    return str(mark or "mark")


def encoding_chart_parts(
    encoding: Any,
    *,
    mark: Any,
    repeat_context: Mapping[str, Sequence[str]] | None = None,
    rows: Sequence[Mapping[str, Any]] = (),
) -> list[dict[str, Any]]:
    parts = []
    if mark is not None or (isinstance(encoding, Mapping) and encoding):
        parts.append(chart_part("mark", mark_label(mark)))
    if not isinstance(encoding, Mapping):
        return parts
    for channel, channel_spec in encoding.items():
        channel_name = str(channel)
        fields = field_labels(channel_spec, repeat_context=repeat_context)
        if channel_name in _AXIS_CHANNELS:
            detail = ", ".join(fields[:4]) if fields else channel_name
            parts.append(chart_part("axis", f"{channel_name[0]} axis", detail))
            continue
        if channel_name in _LEGEND_CHANNELS:
            detail = ", ".join(fields[:4]) if fields else channel_name
            parts.append(chart_part("legend", f"{channel_name} legend", detail))
            continue
        if channel_name in _FACET_CHANNELS:
            field = fields[0] if fields else ""
            detail = ", ".join(fields[:4]) if fields else channel_name
            domain = field_domain(rows, field) if field else []
            context: dict[str, Any] = {}
            if domain:
                context = {
                    "values": domain,
                    "count": len(domain),
                }
            parts.append(
                chart_part(
                    "facet",
                    f"{channel_name} facet"
                    if channel_name in {"column", "row"}
                    else "facet",
                    detail,
                    channel=channel_name,
                    field=field,
                    orientation=channel_name
                    if channel_name in {"column", "row"}
                    else None,
                    context=context,
                )
            )
            continue
        for field_name in fields:
            parts.append(chart_part("annotation", channel_name, field_name))
    return parts


def chart_spec_parts(
    spec: Any,
    repeat_context: Mapping[str, Sequence[str]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(spec, Mapping):
        return []
    repeat_context = {
        **dict(repeat_context or {}),
        **repeat_field_context(spec.get("repeat")),
    }
    parts: list[dict[str, Any]] = []
    title = title_text(spec.get("title"))
    if title:
        parts.append(chart_part("title", title, "chart title"))
    parts.extend(
        facet_chart_parts(
            spec.get("facet"),
            spec=spec,
            repeat_context=repeat_context,
        )
    )
    encoding = spec.get("encoding")
    mark = spec.get("mark")
    rows = inline_data_rows(spec)
    if mark is not None or isinstance(encoding, Mapping):
        parts.extend(
            encoding_chart_parts(
                encoding,
                mark=mark,
                repeat_context=repeat_context,
                rows=rows,
            )
        )
    for child in child_chart_specs(spec):
        parts.extend(chart_spec_parts(child, repeat_context=repeat_context))
    return parts


def facet_chart_parts(
    facet: Any,
    *,
    spec: Mapping[str, Any],
    repeat_context: Mapping[str, Sequence[str]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(facet, Mapping):
        return []

    channel_specs: list[tuple[str, Any]] = []
    if any(channel in facet for channel in _FACET_CHANNELS):
        channel_specs = [
            (channel, facet.get(channel))
            for channel in _FACET_CHANNELS
            if facet.get(channel) is not None
        ]
    else:
        channel_specs = [("facet", facet)]

    parts: list[dict[str, Any]] = []
    rows = inline_data_rows(spec)
    for channel, channel_spec in channel_specs:
        fields = field_labels(channel_spec, repeat_context=repeat_context)
        field = fields[0] if fields else ""
        detail = ", ".join(fields[:4]) if fields else channel
        domain = field_domain(rows, field) if field else []
        label = f"{channel} facet" if channel in {"column", "row"} else "facet"
        context: dict[str, Any] = {}
        if domain:
            context = {
                "values": domain,
                "count": len(domain),
            }
        parts.append(
            chart_part(
                "facet",
                label,
                detail,
                channel=channel,
                field=field,
                orientation=channel if channel in {"column", "row"} else None,
                context=context,
            )
        )
    return parts


def chart_spec_fields(spec: Any) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(
        raw_fields: Any,
        repeat_context: Mapping[str, Sequence[str]] | None = None,
    ) -> None:
        for field_name in field_labels(raw_fields, repeat_context=repeat_context):
            if not field_name or field_name in seen:
                continue
            seen.add(field_name)
            fields.append({"name": field_name, "dtype": None})

    def visit(
        node: Any,
        repeat_context: Mapping[str, Sequence[str]] | None = None,
    ) -> None:
        if not isinstance(node, Mapping):
            return
        repeat_context = {
            **dict(repeat_context or {}),
            **repeat_field_context(node.get("repeat")),
        }
        add(node.get("facet"), repeat_context)
        encoding = node.get("encoding")
        if isinstance(encoding, Mapping):
            for channel_spec in encoding.values():
                add(channel_spec, repeat_context)
        for child in child_chart_specs(node):
            visit(child, repeat_context)
        add(repeat_context.values())

    visit(spec)
    return fields


def inline_data_rows(spec: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    data = spec.get("data")
    if isinstance(data, Sequence) and not isinstance(data, (str, bytes, bytearray)):
        return [row for row in data if isinstance(row, Mapping)]
    if isinstance(data, Mapping):
        values = data.get("values")
        if isinstance(values, Sequence) and not isinstance(
            values, (str, bytes, bytearray)
        ):
            return [row for row in values if isinstance(row, Mapping)]
        name = data.get("name")
        datasets = spec.get("datasets")
        if isinstance(name, str) and isinstance(datasets, Mapping):
            rows = datasets.get(name)
            if isinstance(rows, Sequence) and not isinstance(
                rows, (str, bytes, bytearray)
            ):
                return [row for row in rows if isinstance(row, Mapping)]
    return []


def field_domain(rows: Sequence[Mapping[str, Any]], field: str) -> list[Any]:
    values: list[Any] = []
    seen: set[str] = set()
    for row in rows:
        value = row.get(field)
        if value is None:
            continue
        key = repr(value)
        if key in seen:
            continue
        seen.add(key)
        values.append(value)
        if len(values) >= MAX_VALUE_ITEMS:
            break
    return values


def repeat_field_context(repeat: Any) -> dict[str, list[str]]:
    if isinstance(repeat, Mapping):
        return {
            str(key): field_labels(value)
            for key, value in repeat.items()
            if field_labels(value)
        }
    repeated = field_labels(repeat)
    return {"repeat": repeated} if repeated else {}


def chart_unit_specs(spec: Any) -> list[Mapping[str, Any]]:
    if not isinstance(spec, Mapping):
        return []
    units: list[Mapping[str, Any]] = []
    if spec.get("mark") is not None or isinstance(spec.get("encoding"), Mapping):
        units.append(spec)
    for child in child_chart_specs(spec):
        units.extend(chart_unit_specs(child))
    return units


def child_chart_specs(spec: Mapping[str, Any]) -> list[Any]:
    children: list[Any] = []
    for key in ("layer", "hconcat", "vconcat", "concat"):
        value = spec.get(key)
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            children.extend(value)
    for key in ("spec", "facet", "repeat"):
        value = spec.get(key)
        if isinstance(value, Mapping):
            children.append(value)
    return children


def ordered_unique(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


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
    extensions: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a bounded, JSON-safe chart part descriptor."""

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
        part["extensions"] = safe_value(dict(extensions))
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
