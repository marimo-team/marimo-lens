"""Typed selection contracts for Lens targets."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias

SelectionSurface: TypeAlias = Literal[
    "chart-unit",
    "columnar-dom",
    "columnar-grid",
    "display-cell",
    "document",
    "interactive",
    "marked",
    "media",
    "selector",
    "visual-surface",
]

SelectionGranularity: TypeAlias = Literal["target", "surface", "group", "item", "datum"]


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
    parent_id: str | None = None
    supported: bool = True
    requires: Sequence[str] = ()
    selectors: Sequence[str] = ()
    fallback_for: Sequence[str] = ()
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
            "data": dict(self.data),
        }
        if self.parent_id:
            item["parentId"] = self.parent_id
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


__all__ = [
    "Model",
    "Policy",
    "SelectionGranularity",
    "SelectionSurface",
    "SelectionUnit",
]
