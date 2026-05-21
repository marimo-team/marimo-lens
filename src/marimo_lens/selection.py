"""Typed selection contracts for Lens targets."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ._contract import SelectionGranularity, SelectionSurface


@dataclass(frozen=True)
class Policy:
    """Ordered target surfaces Lens should try when resolving a DOM hit."""

    surfaces: Sequence[SelectionSurface | str] = ()
    context: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def prefer(
        cls,
        *surfaces: SelectionSurface | str,
        context: Mapping[str, Any] | None = None,
    ) -> Policy:
        """Build a policy from the preferred selection surfaces."""

        return cls(surfaces=surfaces, context=dict(context or {}))

    def to_dict(self) -> dict[str, Any]:
        return {
            "prefer": [str(surface) for surface in self.surfaces if str(surface)],
            "context": dict(self.context),
        }


@dataclass(frozen=True)
class SelectionUnit:
    """A semantic subtarget exposed by a Lens target."""

    kind: str
    id: str | None = None
    label: str | None = None
    granularity: SelectionGranularity | str | None = None
    parent_id: str | None = None
    supported: bool = True
    requires: Sequence[str] = ()
    selectors: Sequence[str] = ()
    fallback_for: Sequence[str] = ()
    match: Mapping[str, Any] = field(default_factory=dict)
    priority: int | None = None
    data: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {
            "kind": self.kind,
            "id": self.id or self.kind,
            "label": self.label or self.kind,
            "supported": self.supported,
            "requires": [str(value) for value in self.requires],
            "selectors": [str(value) for value in self.selectors],
            "fallbackFor": [str(value) for value in self.fallback_for],
            "match": dict(self.match),
            "data": dict(self.data),
        }
        if self.granularity:
            item["granularity"] = str(self.granularity)
        if self.parent_id:
            item["parentId"] = self.parent_id
        if self.priority is not None:
            item["priority"] = int(self.priority)
        return item


@dataclass(frozen=True)
class Model:
    """Semantic selection model advertised by a target."""

    units: Sequence[SelectionUnit | Mapping[str, Any]] = ()
    default_fallback: str | None = None

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {
            "units": [_to_dict(unit) for unit in self.units],
        }
        if self.default_fallback:
            item["defaultFallback"] = self.default_fallback
        return item


def _to_dict(value: SelectionUnit | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(value, SelectionUnit):
        return value.to_dict()
    return dict(value)


def unit(
    kind: str,
    *,
    id: str | None = None,
    label: str | None = None,
    granularity: SelectionGranularity | str | None = None,
    parent_id: str | None = None,
    supported: bool = True,
    requires: Sequence[str] = (),
    selectors: Sequence[str] = (),
    fallback_for: Sequence[str] = (),
    match: Mapping[str, Any] | None = None,
    priority: int | None = None,
    data: Mapping[str, Any] | None = None,
) -> SelectionUnit:
    """Describe one semantic unit that frontend evidence can resolve to."""

    return SelectionUnit(
        kind=kind,
        id=id,
        label=label,
        granularity=granularity,
        parent_id=parent_id,
        supported=supported,
        requires=requires,
        selectors=selectors,
        fallback_for=fallback_for,
        match=dict(match or {}),
        priority=priority,
        data=dict(data or {}),
    )


def column(
    name: str,
    *,
    dtype: str | None = None,
    fallback_for: Sequence[str] = (
        "cell",
        "summary-stat",
        "dtype-label",
        "body-cell",
        "grid-cell",
    ),
    selectors: Sequence[str] = (),
    priority: int | None = None,
    data: Mapping[str, Any] | None = None,
) -> SelectionUnit:
    """Describe a column-level semantic unit."""

    unit_data = {"column": name, **dict(data or {})}
    if dtype is not None:
        unit_data["columnDtype"] = dtype
    return unit(
        "column",
        id=f"col:{name}",
        label=name,
        granularity="group",
        fallback_for=fallback_for,
        selectors=selectors,
        match={"column": name},
        priority=priority,
        data=unit_data,
    )


def unsupported_cell() -> SelectionUnit:
    """Advertise that cell evidence should degrade unless a target opts in."""

    return unit(
        "cell",
        id="cell",
        label="cell",
        granularity="item",
        supported=False,
        requires=("rowId", "column"),
    )


__all__ = [
    "Model",
    "Policy",
    "SelectionGranularity",
    "SelectionSurface",
    "SelectionUnit",
    "column",
    "unit",
    "unsupported_cell",
]
