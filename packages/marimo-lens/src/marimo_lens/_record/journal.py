"""Keep a notebook runtime's record of resolved requests.

A journal accepts the lines of one resolution, with the PNGs they name, as a
unit, and returns the lines with the record's health from one read.
``FileJournal`` keeps them in the notebook's ``__marimo__/lens/`` folder.
``MemoryJournal`` keeps them for the runtime's lifetime, as in a marimo app
or in Pyodide.
"""

from __future__ import annotations

import pathlib
import threading
from collections import Counter, deque
from collections.abc import Mapping, Sequence
from typing import Literal, Protocol, TypeAlias

from .lines import RecordHealth, RecordLine, RecordRead, serialize_line

Storage: TypeAlias = Literal["file", "memory"]
"""Where a journal keeps its lines. The host resolves a ``Record.keep`` to one."""

MAX_MEMORY_LINES = 1_024
MAX_MEMORY_BYTES = 64 * 1024 * 1024


class JournalFull(Exception):
    """The journal cannot hold another resolution until it writes what it has."""


class Journal(Protocol):
    def accept(
        self, lines: Sequence[RecordLine], images: Mapping[str, bytes]
    ) -> RecordHealth:
        """Take ownership of one resolution's lines and the PNGs they name.

        ``images`` maps each ``trace.image.sha256`` in ``lines`` to its bytes.

        Raises:
            JournalFull: Accepting the lines would exceed the journal's bounds.
                Nothing was accepted.
        """
        ...

    def read(self) -> RecordRead: ...

    def image(self, sha256: str) -> bytes | None:
        """Return the stored PNG with this digest, or None when it is gone."""
        ...

    def image_path(self, sha256: str) -> pathlib.Path | None:
        """Return the file that holds this PNG, or None when no file does."""
        ...


class MemoryJournal:
    """Keep the newest resolutions in memory for one notebook runtime.

    The journal holds at most ``MAX_MEMORY_LINES`` lines within
    ``MAX_MEMORY_BYTES``, counting each image once. Older resolutions leave
    first, each as a whole, and the health reason counts their lines. The
    newest resolution always stays.
    """

    __slots__ = (
        "_batches",
        "_bytes",
        "_count",
        "_evicted",
        "_images",
        "_lines",
        "_lock",
        "_uses",
    )

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._batches: deque[tuple[tuple[RecordLine, ...], int]] = deque()
        self._images: dict[str, bytes] = {}
        self._uses: Counter[str] = Counter()
        self._bytes = 0
        self._count = 0
        self._evicted = 0
        # The lines of the last read, kept while nothing changes so callers
        # can tell an unchanged record by identity.
        self._lines: tuple[RecordLine, ...] | None = None

    def accept(
        self, lines: Sequence[RecordLine], images: Mapping[str, bytes]
    ) -> RecordHealth:
        with self._lock:
            self._lines = None
            size = sum(len(serialize_line(line)) for line in lines)
            self._batches.append((tuple(lines), size))
            self._bytes += size
            self._count += len(lines)
            for line in lines:
                image = line.trace.image
                if image is None:
                    continue
                if image.sha256 not in self._images:
                    self._images[image.sha256] = images[image.sha256]
                    self._bytes += len(images[image.sha256])
                self._uses[image.sha256] += 1
            while len(self._batches) > 1 and (
                self._count > MAX_MEMORY_LINES or self._bytes > MAX_MEMORY_BYTES
            ):
                self._evict()
            return self._health()

    def image(self, sha256: str) -> bytes | None:
        with self._lock:
            return self._images.get(sha256)

    def image_path(self, sha256: str) -> pathlib.Path | None:
        return None

    def read(self) -> RecordRead:
        with self._lock:
            if self._lines is None:
                self._lines = tuple(
                    line for batch, _size in self._batches for line in batch
                )
            return RecordRead(lines=self._lines, health=self._health())

    def _evict(self) -> None:
        batch, size = self._batches.popleft()
        self._bytes -= size
        self._count -= len(batch)
        self._evicted += len(batch)
        for line in batch:
            image = line.trace.image
            if image is None:
                continue
            self._uses[image.sha256] -= 1
            if not self._uses[image.sha256]:
                del self._uses[image.sha256]
                self._bytes -= len(self._images.pop(image.sha256))

    def _health(self) -> RecordHealth:
        reason = "Kept in this notebook runtime until it restarts."
        if self._evicted:
            noun = "request" if self._evicted == 1 else "requests"
            reason += f" The {self._evicted} oldest {noun} no longer fit."
        return RecordHealth("session", reason)


def has_image(journal: Journal, sha256: str) -> bool:
    """Return whether ``journal`` still holds the PNG with this digest."""

    return journal.image_path(sha256) is not None or journal.image(sha256) is not None
