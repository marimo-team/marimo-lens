"""Typed Python target contract for Lens collection and manual targets."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeAlias

from ._contract import TARGET_KINDS as _TARGET_KINDS
from ._contract import TargetKind
from .selection import Model as SelectionModel
from .selection import Policy as SelectionPolicy


@dataclass(frozen=True)
class Column:
    """Column metadata exposed by columnar Lens targets."""

    name: str
    dtype: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"name": self.name}
        if self.dtype is not None:
            item["dtype"] = self.dtype
        if self.metadata:
            item["metadata"] = dict(self.metadata)
        return item


@dataclass(frozen=True)
class Shape:
    """Tabular or visual extent exposed by a target."""

    rows: int | None = None
    columns: int | None = None

    def to_dict(self) -> dict[str, int]:
        item: dict[str, int] = {}
        if self.rows is not None:
            item["rows"] = self.rows
        if self.columns is not None:
            item["columns"] = self.columns
        return item


@dataclass(frozen=True)
class Capabilities:
    """Behavioral capabilities used by frontend selection plugins."""

    columnar_dom: bool = False
    columnar_grid: bool = False
    data: bool = False
    diagnostic: bool = False
    document: bool = False
    interactive: bool = False
    chart_part: bool = False
    media: bool = False
    visual_surface: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "columnarDom": self.columnar_dom,
            "columnarGrid": self.columnar_grid,
            "data": self.data,
            "diagnostic": self.diagnostic,
            "document": self.document,
            "interactive": self.interactive,
            "chartPart": self.chart_part,
            "media": self.media,
            "visualSurface": self.visual_surface,
        }


@dataclass(frozen=True)
class TargetMetadata:
    """Canonical Python target metadata before wire normalization."""

    id: str
    label: str
    kind: TargetKind | str
    variable: str | None = None
    cell_id: str | None = None
    display_cell_ids: Sequence[str] = ()
    related_cell_ids: Sequence[str] = ()
    defs: Sequence[str] = ()
    refs: Sequence[str] = ()
    shape: Shape | Mapping[str, Any] | None = None
    columns: Sequence[Column | Mapping[str, Any]] = ()
    chart: Any = None
    capabilities: Capabilities | Mapping[str, Any] | None = None
    selection: SelectionPolicy | Mapping[str, Any] | None = None
    selection_model: SelectionModel | Mapping[str, Any] | None = None
    summary: str | None = None
    selectors: Sequence[str] = ()
    python_type: str | None = None
    component: str | None = None
    entity: Mapping[str, Any] | None = None
    output: Mapping[str, Any] | None = None
    output_refs: Sequence[str] = ()
    output_type: str | None = None
    code_preview: str | None = None
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not str(self.id):
            raise ValueError("Lens target id cannot be empty")
        if not str(self.label):
            raise ValueError("Lens target label cannot be empty")
        if str(self.kind) not in _TARGET_KINDS:
            valid = ", ".join(sorted(_TARGET_KINDS))
            raise ValueError(f"Lens target kind must be one of: {valid}")

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "kind": str(self.kind),
        }
        _set(item, "variable", self.variable)
        _set(item, "cellId", self.cell_id)
        _set_sequence(item, "displayCellIds", self.display_cell_ids)
        _set_sequence(item, "relatedCellIds", self.related_cell_ids)
        _set_sequence(item, "defs", self.defs)
        _set_sequence(item, "refs", self.refs)
        _set(item, "shape", _to_mapping(self.shape))
        if self.columns:
            item["columns"] = [_to_mapping(column) for column in self.columns]
        _set(item, "chart", _to_mapping(self.chart))
        _set(item, "capabilities", _to_mapping(self.capabilities))
        _set(item, "selectionPolicy", _to_mapping(self.selection))
        _set(item, "selectionModel", _to_mapping(self.selection_model))
        _set(item, "summary", self.summary)
        _set_sequence(item, "selectors", self.selectors)
        _set(item, "pythonType", self.python_type)
        _set(item, "component", self.component)
        _set(item, "entity", dict(self.entity) if self.entity is not None else None)
        _set(item, "output", dict(self.output) if self.output is not None else None)
        _set_sequence(item, "outputRefs", self.output_refs)
        _set(item, "outputType", self.output_type)
        _set(item, "codePreview", self.code_preview)
        if self.extensions:
            item["extensions"] = dict(self.extensions)
        return item


TargetLike: TypeAlias = TargetMetadata | Mapping[str, Any]


def target_dict(target: TargetLike) -> dict[str, Any]:
    """Convert a typed target spec or internal wire target to a dictionary."""

    if isinstance(target, TargetMetadata):
        return target.to_dict()
    return dict(target.items())


def _to_mapping(value: Any) -> Any:
    if value is None:
        return None
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _set(item: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        item[key] = value


def _set_sequence(item: dict[str, Any], key: str, value: Sequence[Any]) -> None:
    if value:
        item[key] = [str(entry) for entry in value]


__all__ = [
    "Capabilities",
    "Column",
    "Shape",
    "TargetKind",
    "TargetLike",
    "TargetMetadata",
    "target_dict",
]
