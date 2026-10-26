"""Read the active marimo kernel through a Lens runtime adapter."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from .._notebook.snapshot import RuntimeCellStatus, RuntimeSnapshot
from .kernel import RuntimeReadError, runtime_context
from .snapshot import collect_runtime_snapshot, runtime_cell_status


class MarimoRuntimeAdapter:
    """Read the active marimo kernel into detached Lens values."""

    __slots__ = ()

    def snapshot(
        self,
        output_cell_ids: Sequence[str] | None = None,
    ) -> RuntimeSnapshot:
        return collect_runtime_snapshot(output_cell_ids)

    def cell_status(self, cell_id: str) -> RuntimeCellStatus:
        return runtime_cell_status(cell_id)

    def observe_cells(
        self, cell_ids: Sequence[str], on_change: Callable[[], None]
    ) -> Callable[[], None] | None:
        """Invalidate a consumer when a referenced cell's lifecycle ends."""
        try:
            from marimo._runtime.cell_lifecycle_item import CellLifecycleItem

            context = runtime_context()
        except (ImportError, RuntimeReadError):
            return None
        registry = getattr(context, "cell_lifecycle_registry", None)
        if registry is None:
            return None
        active = True

        class Watch(CellLifecycleItem):
            def create(self, context: Any) -> None:
                pass

            def dispose(self, context: Any, deletion: bool) -> bool:
                if active:
                    release()
                    on_change()
                return True

        watches = {cell_id: Watch() for cell_id in dict.fromkeys(cell_ids)}

        def release() -> None:
            nonlocal active
            active = False
            for cell_id, watch in watches.items():
                members = registry.registry.get(cell_id)
                if members is not None:
                    # Disposal may be iterating this set. Keep its iterator and
                    # key alive until the host finishes the lifecycle callback.
                    registry.registry[cell_id] = members - {watch}

        for cell_id, watch in watches.items():
            registry.inject(cell_id, watch)
        return release
