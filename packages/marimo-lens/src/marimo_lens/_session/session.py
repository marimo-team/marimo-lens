"""Run one Lens's use cases against its notebook runtime.

Every operation runs under the Lens's lock. A change publishes as it
commits. A failed publication restores the previous state and republishes it.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from .._context.build import build_lens_context, target_cell_ids
from .._context.lens_context import LensContext
from .._core.bounds import utcnow
from .._core.errors import LensError, Rejection, require_cell, revision_conflict
from .._notebook.snapshot import RuntimeCellStatus, RuntimeSnapshot
from .._schema.selection import ImageAction, Selection, SelectionInput
from .._selection.images import SelectionImage
from .._selection.state import (
    SelectionState,
    activate_selection,
    clear_history,
    clear_selections,
    put_selection,
    remove_selection,
    reopen_selection,
    resolve_selections,
)


class NotebookReads(Protocol):
    """The notebook reads a session needs."""

    def snapshot(self, output_cell_ids: Sequence[str]) -> RuntimeSnapshot: ...

    def cell_status(self, cell_id: str) -> RuntimeCellStatus: ...


@dataclass(frozen=True, slots=True)
class Resolution:
    """What one resolve() closed. ``selections`` feed the receipt event."""

    revision: int
    summary: str | None
    selections: tuple[Selection, ...]


class LensSession:
    """One Lens's selections and History in its notebook runtime."""

    __slots__ = (
        "_closed",
        "_lock",
        "_notebook",
        "_publish",
        "_state",
    )

    def __init__(
        self,
        notebook: NotebookReads,
        *,
        lock: threading.RLock,
        publish: Callable[[dict[str, Any]], None],
    ) -> None:
        self._notebook = notebook
        self._lock = lock
        self._publish = publish
        self._state = SelectionState()
        self._closed = False

    @property
    def state(self) -> SelectionState:
        return self._state

    def put_selection(
        self,
        selection: SelectionInput,
        *,
        image_action: ImageAction,
        expected_revision: int,
        image: bytes | bytearray | memoryview | None,
    ) -> tuple[SelectionState, Selection]:
        with self._lock:
            self._require_open()
            next_state, committed = put_selection(
                self._state,
                selection,
                image_action=image_action,
                expected_revision=expected_revision,
                image=image,
            )
            self._commit(next_state)
            return next_state, committed

    def activate_selection(
        self, selection_id: str, *, expected_revision: int
    ) -> SelectionState:
        with self._lock:
            self._require_open()
            next_state = activate_selection(
                self._state, selection_id, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def delete_selection(
        self, selection_id: str, *, expected_revision: int
    ) -> SelectionState:
        with self._lock:
            self._require_open()
            next_state, _removed = remove_selection(
                self._state, selection_id, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def clear_selections(self, *, expected_revision: int) -> SelectionState:
        with self._lock:
            self._require_open()
            next_state = clear_selections(
                self._state, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def reopen_selection(
        self,
        selection_id: str,
        *,
        resolution_revision: int,
        expected_revision: int,
    ) -> SelectionState:
        with self._lock:
            self._require_open()
            next_state = reopen_selection(
                self._state,
                selection_id,
                resolution_revision,
                expected_revision=expected_revision,
            )
            self._commit(next_state)
            return next_state

    def clear_history(self, *, expected_revision: int) -> SelectionState:
        with self._lock:
            self._require_open()
            next_state = clear_history(self._state, expected_revision=expected_revision)
            self._commit(next_state)
            return next_state

    def image(self, selection_id: str) -> SelectionImage:
        with self._lock:
            self._require_open()
            record = self._state.record(selection_id)
            if record is None or record.image is None:
                raise Rejection(
                    "snapshot_not_found",
                    "The selection has no stored snapshot.",
                )
            return record.image

    def context(self) -> LensContext:
        with self._lock:
            self._require_open()
            state = self._state
        snapshot = self._notebook.snapshot(
            target_cell_ids(state.selections(), state.current_selection_id)
        )
        return build_lens_context(snapshot, state)

    def attention_cells(
        self,
        *,
        cell_id: str | None = None,
        selection_id: str | None = None,
        expected_revision: int | None = None,
    ) -> tuple[str, ...]:
        """Return the cells a cell or open selection points attention at."""

        state = self._state
        revision = state.revision
        if expected_revision is not None and revision != expected_revision:
            raise revision_conflict(expected_revision, revision)
        if selection_id is not None:
            record = state.record(selection_id)
            if record is None:
                raise LensError(
                    "selection_not_found",
                    "The Lens selection does not exist.",
                    revision=revision,
                )
            return tuple(record.selection.target.cell_ids)
        assert cell_id is not None
        require_cell(self._notebook.cell_status(cell_id), revision=revision)
        return (cell_id,)

    def resolve(
        self,
        selection_ids: tuple[str, ...],
        *,
        expected_revision: int,
        summary: str | None,
    ) -> Resolution:
        """Move selections into History together."""

        with self._lock:
            self._require_open()
            current = self._state
            try:
                next_state, resolved = resolve_selections(
                    current,
                    selection_ids,
                    expected_revision=expected_revision,
                    resolved_at=utcnow(),
                    summary=summary,
                )
            except Rejection as error:
                raise LensError(
                    error.code, str(error), revision=current.revision
                ) from error
            self._commit(next_state)
            return Resolution(
                revision=next_state.revision,
                summary=summary,
                selections=tuple(record.selection for record in resolved),
            )

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._state = SelectionState(
                revision=self._state.revision, next_label=self._state.next_label
            )

    def _commit(self, state: SelectionState) -> None:
        """Make ``state`` authoritative and publish it, or restore the previous one."""

        previous = self._state
        self._state = state
        try:
            self._publish(state.payload())
        except Exception as error:
            self._state = previous
            try:
                self._publish(previous.payload())
            except Exception:  # noqa: BLE001 - the original failure propagates
                _add_note(
                    error,
                    "Lens restored local selection state but could not republish it.",
                )
            raise

    def _require_open(self) -> None:
        if self._closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._state.revision,
            )


def _add_note(error: BaseException, note: str) -> None:
    add_note = getattr(error, "add_note", None)
    if add_note is not None:
        add_note(note)
        return
    vars(error)["__notes__"] = [*getattr(error, "__notes__", ()), note]
