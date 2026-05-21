"""Target payload construction and shared target contract helpers."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from ._contract import TARGET_CONTRACT_KEYS

CAPABILITY_SELECTION_SURFACES = (
    ("columnarGrid", "columnar-grid"),
    ("columnarDom", "columnar-dom"),
    ("chartPart", "chart-part"),
    ("visualSurface", "visual-surface"),
    ("media", "media"),
    ("document", "document"),
    ("interactive", "interactive"),
)

TARGET_KIND_PRIORITY = {
    "dataframe": 0,
    "table": 1,
    "visualization": 2,
    "data": 3,
    "document": 4,
    "media": 5,
    "layout": 6,
    "diagnostic": 7,
    "anywidget": 8,
    "ui": 9,
    "object": 10,
}


def build_target_payload(
    *,
    id: str,
    label: str,
    kind: str,
    variable: str | None = None,
    cell_id: str | None = None,
    display_cell_ids: Sequence[str] = (),
    related_cell_ids: Sequence[str] = (),
    defs: Sequence[str] = (),
    refs: Sequence[str] = (),
    shape: Any = None,
    columns: Sequence[Mapping[str, Any]] = (),
    chart: Any = None,
    capabilities: Mapping[str, Any] | None = None,
    selection_model: Mapping[str, Any] | None = None,
    selection_policy: Mapping[str, Any] | None = None,
    summary: str | None = None,
    selectors: Sequence[str] = (),
    python_type: str | None = None,
    component: str | None = None,
    entity: Mapping[str, Any] | None = None,
    output: Mapping[str, Any] | None = None,
    output_refs: Sequence[str] = (),
    output_type: str | None = None,
    code_preview: str | None = None,
    extensions: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the canonical target wire payload without source-specific branches."""

    target: dict[str, Any] = {
        "id": id,
        "label": label,
        "kind": kind,
    }
    copy_present(
        target,
        {
            "variable": variable,
            "cellId": cell_id,
            "displayCellIds": list(display_cell_ids),
            "relatedCellIds": list(related_cell_ids),
            "defs": list(defs),
            "refs": list(refs),
            "shape": shape,
            "columns": list(columns),
            "chart": chart,
            "capabilities": dict(capabilities) if capabilities is not None else None,
            "selectionModel": selection_model,
            "selectionPolicy": selection_policy,
            "summary": summary,
            "selectors": ordered_unique(str(selector) for selector in selectors),
            "pythonType": python_type,
            "component": component,
            "entity": dict(entity) if entity is not None else None,
            "output": dict(output) if output is not None else None,
            "outputRefs": list(output_refs),
            "outputType": output_type,
            "codePreview": code_preview,
            "extensions": dict(extensions) if extensions else None,
        },
    )
    return target


def copy_present(target: dict[str, Any], values: Mapping[str, Any]) -> None:
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, Sequence) and not isinstance(
            value,
            (str, bytes, bytearray),
        ):
            if not value:
                continue
        if isinstance(value, Mapping) and not value:
            continue
        target[key] = value


def target_extensions(metadata: Mapping[str, Any]) -> dict[str, Any]:
    extensions: dict[str, Any] = {}
    raw_extensions = metadata.get("extensions")
    if isinstance(raw_extensions, Mapping):
        extensions.update(dict(raw_extensions))
    extensions.update(
        {
            str(key): item
            for key, item in metadata.items()
            if str(key) not in TARGET_CONTRACT_KEYS and str(key) != "extensions"
        }
    )
    return extensions


def target_family(metadata: Mapping[str, Any], default: str) -> str:
    family = metadata.get("family")
    if family:
        return str(family)
    extensions = metadata.get("extensions")
    if isinstance(extensions, Mapping) and extensions.get("family"):
        return str(extensions["family"])
    return default


def ordered_unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen or not value:
            continue
        seen.add(value)
        result.append(value)
    return result


def python_type_name(value: Any) -> str:
    if value is None:
        return ""
    return f"{type(value).__module__}.{type(value).__qualname__}"


def css_attr(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')
