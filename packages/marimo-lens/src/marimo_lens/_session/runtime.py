"""Hold what every Lens in one notebook runtime shares.

A notebook runtime is one marimo kernel. Its Lens instances share the open
requests, the label sequence, and one record store per storage, and one lock
orders every operation that reads and changes them together.
"""

from __future__ import annotations

import re
import secrets
import threading
import weakref
from collections.abc import Callable, Container, Sequence
from dataclasses import dataclass

from .._core.bounds import MAX_SELECTION_LABEL
from .._core.record import Record
from .._notebook.snapshot import RuntimeSnapshot
from .._record.journal import Journal, Storage
from .._record.lines import RecordLine
from .._record.requests import RequestLedger
from .._record.status import RecordStatus
from .._selection.state import SelectionState

_LABEL = re.compile(r"^S([1-9][0-9]*)$")


MAX_RETAINED_LENSES = 64
MAX_RETAINED_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class RetainedSelections:
    owner: str
    state: SelectionState
    selector: str | None
    generation: str


class RecordStore:
    """One journal of a notebook runtime and the status last computed from it.

    Callers hold the runtime lock.
    """

    __slots__ = ("_kernel", "_status", "journal")

    def __init__(self, journal: Journal, *, kernel: str) -> None:
        self.journal = journal
        self._kernel = kernel
        self._status: tuple[Sequence[RecordLine], object, RecordStatus] | None = None

    def status(
        self, lines: Sequence[RecordLine], snapshot: RuntimeSnapshot
    ) -> RecordStatus:
        """Return the status of ``lines``, reused while the lines and cells hold."""

        inputs = RecordStatus.inputs(snapshot)
        if self._status is not None:
            last_lines, last_inputs, status = self._status
            if last_lines is lines and last_inputs == inputs:
                return status
        status = RecordStatus(lines, snapshot, kernel=self._kernel)
        self._status = (lines, inputs, status)
        return status

    def highest_label(self) -> int:
        return max(
            (
                number
                for line in self.journal.read().lines
                if line.label
                and (match := _LABEL.match(line.label))
                and (number := int(match.group(1))) <= MAX_SELECTION_LABEL
            ),
            default=0,
        )


@dataclass(frozen=True, slots=True)
class KeptRecord:
    """A shared store and the ``Record`` one Lens applies to its own writes."""

    store: RecordStore
    choice: Record


class LensRuntime:
    """The open requests, labels, and record stores of one notebook runtime.

    ``kernel`` tags the record lines this runtime writes, because marimo
    assigns cell IDs by position when it loads a notebook and only lines from
    this runtime can trust their cell IDs.
    """

    __slots__ = (
        "__weakref__",
        "_next_label",
        "_retained",
        "_stores",
        "kernel",
        "lock",
        "requests",
    )

    def __init__(self) -> None:
        self.kernel = secrets.token_hex(8)
        self.lock = threading.RLock()
        self.requests = RequestLedger()
        self._next_label = 1
        self._retained: dict[tuple[str, str], RetainedSelections] = {}
        self._stores: dict[Storage, RecordStore] = {}

    def record(
        self,
        choice: Record,
        *,
        storage: Storage,
        journal: Callable[[Storage], Journal],
    ) -> KeptRecord:
        """Bind ``choice`` to this runtime's store for ``storage``, opening it once.

        A creator rerun binds the store its predecessor used.
        """

        with self.lock:
            store = self._stores.get(storage)
            if store is None:
                store = self._stores[storage] = RecordStore(
                    journal(storage), kernel=self.kernel
                )
            return KeptRecord(store, choice)

    def retain(self, slot: tuple[str, str], selections: RetainedSelections) -> None:
        """Keep a detached aggregate until its construction slot runs again.

        Callers hold ``lock``. Eviction releases the request owner along with
        the image bytes. Source strings shared by baselines count once toward
        the combined source and PNG byte bound.
        """

        self.discard_retained(slot)
        self._retained[slot] = selections
        while (
            len(self._retained) > MAX_RETAINED_LENSES
            or sum(item.state.image_bytes for item in self._retained.values())
            + self.requests.source_bytes(item.owner for item in self._retained.values())
            > MAX_RETAINED_BYTES
        ):
            self.discard_retained(next(iter(self._retained)))

    def adopt(
        self, slot: tuple[str, str], selector: str | None
    ) -> RetainedSelections | None:
        """Take the matching aggregate. Callers hold ``lock``."""

        retained = self._retained.pop(slot, None)
        if retained is not None and retained.selector != selector:
            self.requests.release(retained.owner)
            return None
        return retained

    def has_retained(self, slot: tuple[str, str], generation: str) -> bool:
        with self.lock:
            retained = self._retained.get(slot)
            return retained is not None and retained.generation == generation

    def discard_retained(
        self, slot: tuple[str, str], generation: str | None = None
    ) -> None:
        with self.lock:
            retained = self._retained.get(slot)
            if retained is not None and (
                generation is None or retained.generation == generation
            ):
                del self._retained[slot]
                self.requests.release(retained.owner)

    def release_deleted(self, cells: Container[str]) -> None:
        """Release the aggregates whose creator cell is no longer in ``cells``."""

        with self.lock:
            for slot in [slot for slot in self._retained if slot[0] not in cells]:
                self.discard_retained(slot)

    def next_label(self) -> int:
        """Return the number of the next selection label.

        Labels follow every label this runtime gave out and the highest label
        in every record store it opened, so they keep counting after a kernel
        restart and after another kernel resolved a selection. Callers hold
        ``lock``.
        """

        recorded = max(
            (store.highest_label() for store in self._stores.values()), default=0
        )
        self._next_label = max(self._next_label, recorded + 1)
        return self._next_label

    def take_labels(self, next_label: int) -> None:
        """Record that labels below ``next_label`` are taken. Callers hold ``lock``."""

        self._next_label = max(self._next_label, next_label)


_RUNTIMES: weakref.WeakKeyDictionary[object, LensRuntime] = weakref.WeakKeyDictionary()
_RUNTIMES_LOCK = threading.Lock()


def lens_runtime(scope: object | None) -> LensRuntime:
    """Return the Lens runtime of ``scope``, or a private one outside a kernel."""

    if scope is None:
        return LensRuntime()
    with _RUNTIMES_LOCK:
        runtime = _RUNTIMES.get(scope)
        if runtime is None:
            runtime = _RUNTIMES[scope] = LensRuntime()
        return runtime
