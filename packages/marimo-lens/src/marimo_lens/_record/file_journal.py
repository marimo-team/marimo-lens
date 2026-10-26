"""Write the notebook's record file and keep the lines a write could not commit.

The file format and write order live in ``files``. When marimo renames the
notebook, the journal moves the record to the new name before it next reads
or writes.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import threading
from collections.abc import Callable, Mapping, Sequence

from . import files
from .journal import JournalFull
from .lines import (
    RecordHealth,
    RecordLine,
    RecordRead,
    line_key,
    serialize_line,
)

MAX_PENDING_LINES = 256

MAX_PENDING_BYTES = 64 * 1024 * 1024

_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class FileJournal:
    """Write resolutions to the notebook's record file.

    ``locate`` returns the record file for the notebook now, or None while
    the notebook has no file name. Lines wait in memory until a write
    succeeds, at most ``MAX_PENDING_LINES`` lines within
    ``MAX_PENDING_BYTES`` beyond the resolution being accepted. Past that
    bound the journal refuses new lines instead of dropping old ones.
    """

    __slots__ = (
        "_locate",
        "_lock",
        "_move_failure",
        "_path",
        "_pending",
        "_stored",
        "_verified",
        "_write_failure",
    )

    def __init__(self, locate: Callable[[], pathlib.Path | None]) -> None:
        self._locate = locate
        self._lock = threading.Lock()
        self._path: pathlib.Path | None = None
        self._pending: list[files.Pending] = []
        self._write_failure: str | None = None
        self._move_failure: str | None = None
        self._stored: files.Stored | None = None
        self._verified: dict[pathlib.Path, tuple[int, int]] = {}

    def accept(
        self, lines: Sequence[RecordLine], images: Mapping[str, bytes]
    ) -> RecordHealth:
        entries = [
            files.Pending(
                line,
                serialize_line(line),
                images[line.trace.image.sha256] if line.trace.image else None,
            )
            for line in lines
        ]
        with self._lock:
            path = self._record()
            if not self._fits(entries):
                self._flush(path)
            if not self._fits(entries):
                raise JournalFull(
                    "The record holds as many unwritten requests as it can. "
                    + (
                        "Save the notebook so Lens can write them."
                        if path is None
                        else "Make its folder writable so Lens can write them."
                    )
                )
            self._pending.extend(entries)
            self._flush(path)
            return self._health(path, None)

    def read(self) -> RecordRead:
        with self._lock:
            path = self._record()
            self._flush(path)
            stored = self._read_stored(path)
            # Without pending lines the stored tuple itself returns, so a
            # caller can tell an unchanged record by identity.
            pending = tuple(
                entry.line
                for entry in self._pending
                if self._stored is None or line_key(entry.line) not in self._stored.seen
            )
            return RecordRead(
                lines=(*stored.lines, *pending) if pending else stored.lines,
                health=self._health(path, stored.error),
                skipped=stored.skipped,
                truncated=stored.truncated,
                error=stored.error,
            )

    def image(self, sha256: str) -> bytes | None:
        if not _SHA256.match(sha256):
            return None
        with self._lock:
            for entry in self._pending:
                image = entry.line.trace.image
                if image is not None and image.sha256 == sha256:
                    return entry.image
            path = self._image_file(sha256)
            if path is None:
                return None
            try:
                data = path.read_bytes()
            except OSError:
                return None
            return data if hashlib.sha256(data).hexdigest() == sha256 else None

    def image_path(self, sha256: str) -> pathlib.Path | None:
        if not _SHA256.match(sha256):
            return None
        with self._lock:
            path = self._image_file(sha256)
            if path is None:
                return None
            try:
                stat = path.stat()
            except OSError:
                return None
            stamp = (stat.st_mtime_ns, stat.st_size)
            if self._verified.get(path) != stamp:
                try:
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                except OSError:
                    return None
                if digest != sha256:
                    return None
                self._verified[path] = stamp
            return path

    def _image_file(self, sha256: str) -> pathlib.Path | None:
        record = self._record()
        return None if record is None else record.parent / "images" / f"{sha256}.png"

    def _record(self) -> pathlib.Path | None:
        """Locate the record file, moving it after marimo renamed the notebook."""

        path = self._locate()
        if path is None:
            return None
        if self._path is not None and self._path != path:
            try:
                files.move_record(self._path, path)
            except OSError as error:
                # Stay on the intact old file until a later call moves it.
                detail = str(error) or type(error).__name__
                self._move_failure = (
                    f"Lens could not move the record to {path}: {detail}"
                )
                return self._path
        self._path, self._move_failure = path, None
        return path

    def _fits(self, entries: Sequence[files.Pending]) -> bool:
        # A single resolution always fits, so its images can use the whole
        # image budget that selections allow.
        if not self._pending:
            return True
        count = len(self._pending) + len(entries)
        size = sum(
            len(entry.data) + len(entry.image or b"")
            for entry in (*self._pending, *entries)
        )
        return count <= MAX_PENDING_LINES and size <= MAX_PENDING_BYTES

    def _flush(self, path: pathlib.Path | None) -> None:
        if path is None or not self._pending:
            return
        try:
            files.append(path, self._pending)
        except OSError as error:
            for entry in self._pending:
                entry.attempted = True
            detail = str(error) or type(error).__name__
            self._write_failure = f"Lens could not write the record: {detail}"
        else:
            self._pending.clear()
            self._write_failure = None

    def _read_stored(self, path: pathlib.Path | None) -> RecordRead:
        empty = RecordRead(lines=(), health=RecordHealth("saved"))
        if path is None:
            return empty
        try:
            stat = path.stat()
            key = (str(path), stat.st_mtime_ns, stat.st_size)
            if self._stored is None or self._stored.key != key:
                self._stored = files.read_stored(path, key)
        except FileNotFoundError:
            return empty
        except OSError as error:
            detail = str(error) or type(error).__name__
            return RecordRead(
                lines=(),
                health=RecordHealth("failed"),
                error=f"Lens could not read the record: {detail}",
            )
        return self._stored.read

    def _health(self, path: pathlib.Path | None, error: str | None) -> RecordHealth:
        if path is None:
            return RecordHealth("unsaved", "The notebook has no file name yet.")
        reason = self._write_failure or self._move_failure or error
        if reason is not None:
            return RecordHealth("failed", reason)
        return RecordHealth("saved")
