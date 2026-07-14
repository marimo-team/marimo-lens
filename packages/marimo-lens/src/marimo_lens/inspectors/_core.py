"""Core inspector protocols and registry."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, cast

if TYPE_CHECKING:
    from ..targets import TargetMetadata

    InspectionMetadata = TargetMetadata | Mapping[str, Any]
else:
    InspectionMetadata = Mapping[str, Any]


@dataclass(frozen=True)
class LensEntity:
    """A Python object plus its marimo lineage envelope."""

    name: str
    value: Any
    graph: Mapping[str, Any]
    cell_id: str | None
    display_cell_ids: Sequence[str]
    related_cell_ids: Sequence[str]
    cell: Mapping[str, Any] | None = None


Entity = LensEntity


class EntityInspector(Protocol):
    """Inspect one family of Python objects and return target metadata."""

    id: str

    def inspect(self, entity: LensEntity) -> InspectionMetadata | None: ...


@dataclass(frozen=True)
class EntityInspection:
    inspector_id: str
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class EntityRegistry:
    """Ordered registry of object-family inspectors."""

    inspectors: Sequence[EntityInspector]

    def inspect(self, entity: LensEntity) -> EntityInspection | None:
        for inspector in self.inspectors:
            metadata = inspector.inspect(entity)
            if metadata is not None:
                to_dict = getattr(metadata, "to_dict", None)
                normalized = cast(
                    Mapping[str, Any],
                    to_dict() if callable(to_dict) else metadata,
                )
                return EntityInspection(inspector.id, dict(normalized.items()))
        return None

    def with_inspectors(
        self,
        inspectors: Sequence[EntityInspector],
        *,
        prepend: bool = True,
    ) -> EntityRegistry:
        incoming = tuple(inspectors)
        incoming_ids = {inspector.id for inspector in incoming}
        existing = tuple(
            inspector
            for inspector in self.inspectors
            if inspector.id not in incoming_ids
        )
        ordered = (*incoming, *existing) if prepend else (*existing, *incoming)
        return EntityRegistry(ordered)

    def replace_inspector(
        self,
        inspector_id: str,
        inspector: EntityInspector,
    ) -> EntityRegistry:
        """Replace an inspector by id while preserving registry order."""

        replaced = False
        ordered: list[EntityInspector] = []
        for current in self.inspectors:
            if current.id != inspector_id:
                ordered.append(current)
                continue
            if not replaced:
                ordered.append(inspector)
                replaced = True
        if not replaced:
            ordered.append(inspector)
        return EntityRegistry(tuple(ordered))


def default_entity_inspectors() -> tuple[EntityInspector, ...]:
    from .anywidget import AnyWidgetInspector
    from .charts import ChartInspector
    from .marimo_components import MarimoComponentInspector
    from .marimo_ui import MarimoUiInspector
    from .media import MediaInspector
    from .object import ObjectInspector
    from .outputs import OutputInspector
    from .table import TableInspector
    from .tabular import TabularInspector

    return (
        MarimoComponentInspector(),
        MarimoUiInspector(),
        AnyWidgetInspector(),
        TabularInspector(),
        ChartInspector(),
        OutputInspector(),
        MediaInspector(),
        TableInspector(),
        ObjectInspector(),
    )


def default_entity_registry() -> EntityRegistry:
    return EntityRegistry(default_entity_inspectors())


def entity_kind(value: Any, registry: EntityRegistry | None = None) -> str:
    entity = LensEntity(
        name="target",
        value=value,
        graph={},
        cell_id=None,
        display_cell_ids=(),
        related_cell_ids=(),
    )
    inspection = (registry or default_entity_registry()).inspect(entity)
    if inspection is None:
        return "object"
    return str(inspection.metadata.get("kind") or "object")
