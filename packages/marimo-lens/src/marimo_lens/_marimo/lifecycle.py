"""Bind creator reruns to marimo's cell membership and comm disposal."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from .._session.runtime import LensRuntime
from .kernel import RuntimeReadError, current_cell_id, runtime_context


def construction_slot() -> tuple[str, str] | None:
    """Take a native deterministic ID while a notebook cell is executing."""

    try:
        from marimo._plugins.ui._core.ids import NoIDProviderException
        from marimo._runtime.cell_lifecycle_registry import CellLifecycleRegistry

    except ImportError:
        return None
    try:
        context = runtime_context()
        cell_id = current_cell_id()
        if cell_id is None or not isinstance(
            getattr(context, "cell_lifecycle_registry", None), CellLifecycleRegistry
        ):
            return None
        take_id = getattr(context, "take_id", None)
        if not callable(take_id):
            return None
        return cell_id, str(take_id())
    except (RuntimeReadError, NoIDProviderException):
        return None


def bind_creator_lifecycle(
    comm: Any,
    slot: tuple[str, str],
    generation: str,
    runtime: LensRuntime,
    on_dispose: Callable[[bool], None],
) -> bool:
    """Replace this comm's native item, checking the creator's cell membership.

    Unknown comms keep their ordinary destructive close path. The retained
    cleanup item drops its comm and weak widget callback after first disposal.
    """

    try:
        from marimo._plugins.ui._impl.anywidget.init import CommLifecycleItem
        from marimo._runtime.cell_lifecycle_item import CellLifecycleItem

        context = runtime_context()
    except (ImportError, RuntimeReadError):
        return False
    metadata = getattr(getattr(context, "_kernel", None), "cell_metadata", None)
    if not isinstance(metadata, Mapping):
        return False
    # An edit that leaves the creator unable to register, such as a syntax
    # error, keeps its lifecycle items out of marimo's deletion path. The next
    # Lens releases what such a deleted creator retained.
    runtime.release_deleted(metadata)
    registry = context.cell_lifecycle_registry
    members = registry.registry.get(slot[0], set())
    native = [
        item
        for item in members
        if type(item) is CommLifecycleItem and item._comm is comm
    ]
    if not native:
        return False

    class CreatorLifecycle(CellLifecycleItem):
        def __init__(
            self, callback: Callable[[bool], None], items: tuple[CommLifecycleItem, ...]
        ) -> None:
            self.callback: Callable[[bool], None] | None = callback
            self.items = items

        def create(self, context: Any) -> None:
            pass

        def dispose(self, context: Any, deletion: bool) -> bool:
            # Kernel._delete_cell drops metadata before disposal. Edits keep
            # metadata and pass deletion=True for the cell and its descendants.
            rerun = slot[0] in metadata
            callback, self.callback = self.callback, None
            items, self.items = self.items, ()
            if callback is not None:
                try:
                    callback(rerun)
                finally:
                    for item in items:
                        item.dispose(context, deletion)
            # marimo may invalidate a descendant repeatedly before it executes.
            if not rerun:
                runtime.discard_retained(slot, generation)
            return not runtime.has_retained(slot, generation)

    # Replacing the exact comm item avoids depending on set iteration order.
    registry.registry[slot[0]] = members.difference(native) | {
        CreatorLifecycle(on_dispose, tuple(native))
    }
    return True
