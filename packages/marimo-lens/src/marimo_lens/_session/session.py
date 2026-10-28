"""Run one Lens's use cases against its notebook runtime.

Every operation runs under the runtime's lock. A change commits first and is
published after. A failed publication leaves the committed state in place,
and the next publication repairs browser views.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Protocol

from .._checks import check_record, check_selections
from .._context.build import RecordView, build_lens_context, target_cell_ids
from .._context.lens_context import LensContext
from .._core.bounds import MAX_CHAT_REQUESTS, MAX_SELECTIONS, utcnow
from .._core.errors import LensError, Rejection, require_cell, revision_conflict
from .._core.record import Record
from .._core.types import Diagnostic
from .._notebook.snapshot import RuntimeCellStatus, RuntimeSnapshot
from .._record.history import history_state, reopened_selection
from .._record.journal import JournalFull, has_image
from .._record.lines import OpenRequest, build_line
from .._record.requests import chat_reference
from .._schema.selection import ImageAction, Selection, SelectionInput
from .._selection.images import SelectionImage
from .._selection.references import (
    MAX_CHAT_REFERENCES_BYTES,
    chat_reference_size,
)
from .._selection.state import (
    SelectionState,
    activate_selection,
    clear_selections,
    put_selection,
    remove_selection,
    reopen_selection,
    resolve_selections,
)
from .runtime import KeptRecord, LensRuntime, RecordStore, RetainedSelections

_LOGGER = logging.getLogger(__name__)

MAX_REQUEST_CELLS = 16

MAX_RESOLVED_REQUESTS = MAX_SELECTIONS + MAX_CHAT_REQUESTS


class NotebookReads(Protocol):
    """The notebook reads a session needs."""

    def snapshot(self, output_cell_ids: Sequence[str]) -> RuntimeSnapshot: ...

    def notebook(self, cell_ids: Sequence[str] = ()) -> RuntimeSnapshot:
        """Read every cell's code, ``cell_ids`` first, without controls."""
        ...

    def cell_status(self, cell_id: str) -> RuntimeCellStatus: ...


@dataclass(frozen=True, slots=True)
class Resolution:
    """What one resolve() closed. ``selections`` feed the receipt event."""

    revision: int
    resolved_at: str
    summary: str | None
    selections: tuple[Selection, ...]
    chats: tuple[str, ...]


class LensSession:
    """One Lens's selections and requests in its notebook runtime.

    History follows the record, the notebook, and the open selections, so the
    session publishes it when a view prepares, when a resolution lands, when
    the open selections change, and on refresh. ``clock`` stamps the times
    requests open and resolve.
    """

    __slots__ = (
        "_clock",
        "_closed",
        "_generation",
        "_notebook",
        "_owner",
        "_publish",
        "_publish_history",
        "_record",
        "_runtime",
        "_selector",
        "_slot",
        "_state",
    )

    def __init__(
        self,
        runtime: LensRuntime,
        notebook: NotebookReads,
        *,
        record: KeptRecord | None,
        owner: str,
        publish: Callable[[dict[str, Any]], None],
        publish_history: Callable[[dict[str, Any]], None],
        clock: Callable[[], str] | None = None,
    ) -> None:
        self._runtime = runtime
        self._clock = utcnow if clock is None else clock
        self._notebook = notebook
        self._record = record
        self._owner = owner
        self._publish = publish
        self._publish_history = publish_history
        self._state = SelectionState()
        self._closed = False
        self._slot: tuple[str, str] | None = None
        self._selector: str | None = None
        self._generation = ""

    @property
    def state(self) -> SelectionState:
        return self._state

    @property
    def record(self) -> Record | None:
        return None if self._record is None else self._record.choice

    def prepare(self) -> None:
        with self._runtime.lock:
            self._require_open()
            next_label = self._runtime.next_label()
            if next_label != self._state.next_label:
                self._state = replace(self._state, next_label=next_label)
                self._send(self._state)
            self._send_history()

    def refresh_history(self) -> None:
        with self._runtime.lock:
            self._require_open()
            self._require_history()
            self._send_history()

    def put_selection(
        self,
        selection: SelectionInput,
        *,
        image_action: ImageAction,
        expected_revision: int,
        image: bytes | bytearray | memoryview | None,
    ) -> tuple[SelectionState, Selection]:
        with self._runtime.lock:
            self._require_open()
            next_state, committed = put_selection(
                replace(self._state, next_label=self._runtime.next_label()),
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
        with self._runtime.lock:
            self._require_open()
            next_state = activate_selection(
                self._state, selection_id, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def delete_selection(
        self, selection_id: str, *, expected_revision: int
    ) -> SelectionState:
        with self._runtime.lock:
            self._require_open()
            next_state, _removed = remove_selection(
                self._state, selection_id, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def clear_selections(self, *, expected_revision: int) -> SelectionState:
        with self._runtime.lock:
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
        resolved_at: str,
        document_id: str,
        document_path: str,
        expected_revision: int,
    ) -> SelectionState:
        with self._runtime.lock:
            self._require_open()
            store = self._require_history()
            holder = self._runtime.requests.get(selection_id)
            if holder is not None and holder.owner != self._owner:
                raise Rejection(
                    "selection_already_open",
                    "Another Lens holds this selection open.",
                )
            read = store.journal.read()
            line = next(
                (
                    line
                    for line in reversed(read.lines)
                    if line.id == selection_id and line.resolved_at == resolved_at
                ),
                None,
            )
            if line is None or line.channel != "selection":
                raise Rejection(
                    "history_not_found",
                    "This resolved selection is not in this Lens's record.",
                )
            notebook = self._notebook.notebook(
                [cell.cell_id for cell in line.trace.cells]
            )
            status = store.status(read.lines, notebook)
            try:
                selection = reopened_selection(
                    line,
                    status.trace(line),
                    document_id=document_id,
                    document_path=document_path,
                )
            except ValueError as error:
                raise Rejection("history_not_found", str(error)) from error
            next_state = reopen_selection(
                self._state, selection, expected_revision=expected_revision
            )
            self._commit(next_state)
            return next_state

    def recorded_image(self, sha256: str) -> bytes:
        with self._runtime.lock:
            self._require_open()
            data = self._require_history().journal.image(sha256)
            if data is None:
                raise Rejection(
                    "history_image_not_found",
                    "This Lens's record no longer holds this image.",
                )
            return data

    def image(self, selection_id: str) -> SelectionImage:
        with self._runtime.lock:
            self._require_open()
            record = self._state.record(selection_id)
            if record is None or record.image is None:
                raise Rejection(
                    "snapshot_not_found",
                    "The selection has no stored snapshot.",
                )
            return record.image

    def context(self, *, mounted: bool = True) -> LensContext:
        """Project the selection state, and the record when kept, into a context.

        ``mounted`` False leaves the brief's calls on a mounted Lens out, for a
        host that serves none, such as a notebook file.
        """

        with self._runtime.lock:
            self._require_open()
            state = self._state
            chats = [
                chat_reference(request) for request in self._runtime.requests.chats()
            ]
            opened = self._selection_requests(state)
            snapshot = self._notebook.snapshot(
                [
                    *target_cell_ids(state.selections(), state.current_selection_id),
                    *(cell["id"] for chat in chats for cell in chat["cells"]),
                ]
            )
            view = None
            if self._record is not None:
                store = self._record.store
                read = store.journal.read()
                view = RecordView(
                    health=read.health,
                    status=store.status(read.lines, snapshot),
                    image_path=store.journal.image_path,
                )
            return build_lens_context(
                snapshot,
                state,
                record=view,
                chat_requests=chats,
                opened=opened,
                order=self._runtime.requests.order(),
                mounted=mounted,
            )

    def check(self) -> list[Diagnostic]:
        with self._runtime.lock:
            self._require_open()
            state = self._state
            opened = self._selection_requests(state)
            selections = state.selections()
            snapshot = self._notebook.notebook(
                target_cell_ids(selections, state.current_selection_id)
            )
            diagnostics = check_selections(
                selections,
                {
                    selection_id: request.baseline
                    for selection_id, request in opened.items()
                },
                snapshot,
            )
            if self._record is not None:
                journal = self._record.store.journal
                read = journal.read()
                diagnostics.extend(
                    check_record(
                        read,
                        self._record.store.status(read.lines, snapshot),
                        has_image=lambda sha256: has_image(journal, sha256),
                    )
                )
        return sorted(diagnostics, key=lambda item: item["severity"] != "warning")

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

    def open_request(self, note: str, cell_ids: tuple[str, ...]) -> str:
        with self._runtime.lock:
            self._require_open()
            revision = self._state.revision
            notebook = self._notebook.notebook(cell_ids)
            if cell_ids and not notebook.available:
                raise LensError(
                    "runtime_unavailable",
                    "Lens cannot inspect the active marimo runtime.",
                    revision=revision,
                )
            known = {cell.id for cell in (*notebook.cells, *notebook.unregistered)}
            unknown = [cell_id for cell_id in cell_ids if cell_id not in known]
            if unknown:
                raise LensError(
                    "cell_not_found",
                    f"The notebook has no cell {unknown[0]!r}.",
                    revision=revision,
                )
            requests = self._runtime.requests
            open_chats = requests.chats()
            if len(open_chats) >= MAX_CHAT_REQUESTS:
                raise LensError(
                    "request_limit_reached",
                    f"Lens keeps up to {MAX_CHAT_REQUESTS} open chat requests. "
                    "Resolve one before opening another.",
                    revision=revision,
                )
            request = OpenRequest(
                id=f"chat-{uuid.uuid4().hex[:12]}",
                channel="chat",
                opened_at=self._clock(),
                baseline=notebook,
                note=note,
                cell_ids=cell_ids,
            )
            references = [chat_reference(chat) for chat in (*open_chats, request)]
            if chat_reference_size(references) > MAX_CHAT_REFERENCES_BYTES:
                raise LensError(
                    "request_limit_reached",
                    "The open chat requests name too many cells to share with "
                    "an agent. Resolve one before opening another.",
                    revision=revision,
                )
            return requests.add(request).id

    def resolve(
        self,
        request_ids: tuple[str, ...],
        *,
        expected_revision: int,
        summary: str | None,
    ) -> Resolution:
        """Resolve selection and chat requests together.

        With a record, the store takes the resolution before any request
        closes, so a refused record leaves every request open.
        """

        with self._runtime.lock:
            self._require_open()
            current = self._state
            requests = self._runtime.requests
            chat_ids = tuple(
                request_id
                for request_id in request_ids
                if (request := requests.get(request_id)) is not None
                and request.channel == "chat"
            )
            selection_ids = tuple(
                request_id for request_id in request_ids if request_id not in chat_ids
            )
            missing = next(
                (
                    request_id
                    for request_id in selection_ids
                    if current.record(request_id) is None
                ),
                None,
            )
            if missing is not None:
                raise LensError(
                    "request_not_found",
                    f"Lens has no open request {missing!r}.",
                    revision=current.revision,
                )
            if selection_ids and current.revision != expected_revision:
                raise revision_conflict(expected_revision, current.revision)
            next_state, resolved = (
                resolve_selections(current, selection_ids)
                if selection_ids
                else (current, ())
            )
            resolved_at = self._clock()
            if self._record is not None:
                keep_images = self._record.choice.images
                resolving = [
                    *((requests[record.id], record) for record in resolved),
                    *(
                        (request, None)
                        for chat_id in chat_ids
                        if (request := requests.get(chat_id)) is not None
                    ),
                ]
                notebook = self._notebook.notebook(
                    [
                        cell_id
                        for request, record in resolving
                        for cell_id in (
                            record.selection.target.cell_ids
                            if record is not None
                            else request.cell_ids
                        )
                    ]
                )
                lines = [
                    build_line(
                        request,
                        notebook,
                        selection=record,
                        image=keep_images,
                        kernel=self._runtime.kernel,
                        resolved_at=resolved_at,
                        revision=next_state.revision,
                        summary=summary,
                    )
                    for request, record in resolving
                ]
                images = {
                    record.image.sha256: record.image.data
                    for record in resolved
                    if keep_images and record.image is not None
                }
                try:
                    self._record.store.journal.accept(lines, images)
                except JournalFull as error:
                    raise LensError(
                        "record_full", str(error), revision=current.revision
                    ) from error
            requests.close(chat_ids)
            if resolved:
                self._commit(next_state)
            else:
                self._send_history()
            return Resolution(
                revision=next_state.revision,
                resolved_at=resolved_at,
                summary=summary,
                selections=tuple(record.selection for record in resolved),
                chats=chat_ids,
            )

    def attach(
        self, slot: tuple[str, str], *, selector: str | None, generation: str
    ) -> None:
        """Adopt the prior creator's state after host lifecycle binding succeeds."""

        with self._runtime.lock:
            self._require_open()
            self._slot, self._selector, self._generation = slot, selector, generation
            retained = self._runtime.adopt(slot, selector)
            if retained is not None:
                self._owner, self._state = retained.owner, retained.state
                self._send(self._state)
                self._send_history()

    def detach(self) -> None:
        with self._runtime.lock:
            if self._closed:
                return
            if self._slot is not None:
                self._runtime.retain(
                    self._slot,
                    RetainedSelections(
                        self._owner, self._state, self._selector, self._generation
                    ),
                )
                self._closed = True
                self._state = SelectionState(
                    revision=self._state.revision, next_label=self._state.next_label
                )
            else:
                self.close()

    def close(self) -> None:
        with self._runtime.lock:
            if self._closed:
                return
            self._closed = True
            self._runtime.requests.release(self._owner)
            self._state = SelectionState(
                revision=self._state.revision, next_label=self._state.next_label
            )

    def _commit(self, state: SelectionState) -> None:
        """Make ``state`` authoritative, keep requests in step, then publish it.

        The baseline of a new or reopened selection is read before anything
        changes.
        """

        requests = self._runtime.requests
        opening = requests.unopened(record.id for record in state.records)
        baseline = self._notebook.notebook() if opening else None
        reshaped = self._open_ids(self._state) != self._open_ids(state)
        self._state = state
        self._runtime.take_labels(state.next_label)
        requests.sync_selections(
            self._owner,
            (record.id for record in state.records),
            opened_at=self._clock(),
            baseline=baseline,
        )
        self._send(state)
        if reshaped:
            self._send_history()

    @staticmethod
    def _open_ids(state: SelectionState) -> frozenset[str]:
        return frozenset(record.id for record in state.records)

    def _send(self, state: SelectionState) -> None:
        try:
            self._publish(state.payload())
        except Exception:
            _LOGGER.exception("Lens could not publish its selection state")

    def _history_store(self) -> RecordStore | None:
        if self._record is None or not self._record.choice.history:
            return None
        return self._record.store

    def _require_history(self) -> RecordStore:
        store = self._history_store()
        if store is None:
            raise Rejection("history_off", "This Lens shows no History.")
        return store

    def _send_history(self) -> None:
        """Publish History, or nothing when the projection fails, so views keep theirs."""

        store = self._history_store()
        if store is None:
            return
        state = self._state
        try:
            read = store.journal.read()
            status = store.status(read.lines, self._notebook.notebook())
            history = history_state(
                status,
                read.lines,
                read.health,
                selections={
                    record.id: tuple(record.selection.target.cell_ids)
                    for record in state.records
                },
            )
        except Exception:
            _LOGGER.exception("Lens could not project the record into History")
            return
        try:
            self._publish_history(history)
        except Exception:
            _LOGGER.exception("Lens could not publish History")

    def _selection_requests(self, state: SelectionState) -> dict[str, OpenRequest]:
        return {
            record.id: request
            for record in state.records
            if (request := self._runtime.requests.get(record.id)) is not None
        }

    def _require_open(self) -> None:
        if self._closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._state.revision,
            )
