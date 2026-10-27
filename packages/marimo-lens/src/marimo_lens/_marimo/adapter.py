"""Give a Lens session its notebook reads and record storage from the running marimo kernel."""

from __future__ import annotations

import sys
from collections.abc import Callable, Sequence
from typing import Any

from .._core.record import Keep
from .._notebook.snapshot import (
    RuntimeCellStatus,
    RuntimeSnapshot,
)
from .._record.file_journal import FileJournal
from .._record.journal import Journal, MemoryJournal, Storage
from .kernel import (
    RuntimeReadError,
    edit_session,
    record_path,
    runtime_context,
)
from .snapshot import collect_runtime_snapshot, runtime_cell_status


class MarimoRuntimeAdapter:
    """Read the active marimo kernel into detached Lens values."""

    __slots__ = ()

    def snapshot(self, output_cell_ids: Sequence[str]) -> RuntimeSnapshot:
        return collect_runtime_snapshot(output_cell_ids)

    def notebook(self, cell_ids: Sequence[str] = ()) -> RuntimeSnapshot:
        """Read every cell's code without probing controls, ``cell_ids`` first."""

        return collect_runtime_snapshot(cell_ids, controls=False)

    def storage(self, keep: Keep) -> Storage:
        """Return where this host keeps a record chosen with ``keep``.

        Only the marimo editor writes files. An app keeps each visitor's
        requests apart, and Pyodide names every notebook ``notebook.py`` in
        storage no agent can read, so both keep the record in memory.
        """

        if keep == "notebook" and edit_session() and sys.platform != "emscripten":
            return "file"
        return "memory"

    def journal(self, storage: Storage) -> Journal:
        """Open the journal for ``storage``. A file journal finds its path lazily."""

        if storage == "file":
            return FileJournal(record_path)
        return MemoryJournal()

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
