"""Keep a notebook's record as JSON Lines in its ``__marimo__/lens/`` folder.

Selection images live beside the record as ``images/<sha256>.png``. An image
is written whole under its digest before the line that names it, so a line
never names an image the writer did not finish. A newline commits a line.
Under the writer lock, an append first drops an unterminated final fragment,
which only a writer that stopped mid-line leaves, then appends whole lines.
Readers ignore an unterminated final line, because another process may still
be writing it.
"""

from __future__ import annotations

import errno
import hashlib
import os
import pathlib
import sys
import tempfile
import time
from collections.abc import Generator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from typing import IO

from .lines import (
    MAX_LINE_BYTES,
    RecordHealth,
    RecordLine,
    RecordRead,
    line_key,
    parse_line,
)

MAX_READ_BYTES = 16 * 1024 * 1024


LOCK_TIMEOUT_SECONDS = 2.0

# The lock is held by someone else. Any other error fails the write, because
# appending without the lock could interleave lines from two kernels.
_BUSY = frozenset({errno.EACCES, errno.EAGAIN, errno.EWOULDBLOCK, errno.EDEADLK})


@dataclass(slots=True)
class Pending:
    line: RecordLine
    data: bytes
    # The PNG that ``line.trace.image`` names, kept until the line is written.
    image: bytes | None
    # A failed write may still have reached the file, so the next write
    # checks the file for this line first.
    attempted: bool = False


@dataclass(frozen=True, slots=True)
class Stored:
    """The last read of the record file, keyed by its path, mtime, and size."""

    key: tuple[str, int, int]
    seen: set[tuple[str, str, str]]
    read: RecordRead


def read_stored(path: pathlib.Path, key: tuple[str, int, int]) -> Stored:
    """Read the committed lines in the last ``MAX_READ_BYTES`` of the record."""

    with open(path, "rb") as handle:
        size = handle.seek(0, os.SEEK_END)
        truncated = size > MAX_READ_BYTES
        # One byte before the window tells whether it starts a line.
        handle.seek(size - MAX_READ_BYTES - 1 if truncated else 0)
        data = handle.read()
    committed = data[: data.rfind(b"\n") + 1]
    if truncated:
        committed = committed[committed.find(b"\n") + 1 :]
    seen: set[tuple[str, str, str]] = set()
    lines, skipped = _parse(committed, seen)
    return Stored(
        key=key,
        seen=seen,
        read=RecordRead(
            lines=tuple(lines),
            health=RecordHealth("saved"),
            skipped=skipped,
            truncated=truncated,
        ),
    )


def _parse(
    committed: bytes, seen: set[tuple[str, str, str]]
) -> tuple[list[RecordLine], int]:
    """Parse committed lines, keeping one copy of each line ``seen`` lacks."""

    lines: list[RecordLine] = []
    skipped = 0
    for raw in committed.split(b"\n"):
        if not raw.strip():
            continue
        line = parse_line(raw)
        if line is None:
            skipped += 1
        elif line_key(line) not in seen:
            seen.add(line_key(line))
            lines.append(line)
    return lines, skipped


def append(path: pathlib.Path, entries: Sequence[Pending]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        image = entry.line.trace.image
        if image is not None and entry.image is not None:
            store_image(path.parent / "images", image.sha256, entry.image)
    _append_lines(
        path,
        [entry.data for entry in entries],
        skip_held=any(entry.attempted for entry in entries),
    )


def _append_lines(
    path: pathlib.Path, lines: Sequence[bytes], *, skip_held: bool
) -> None:
    """Append whole newline-terminated lines under the writer lock.

    With ``skip_held``, lines the file already holds stay out, so a retried
    write or move adds nothing twice.
    """

    for _attempt in range(3):
        with open(path, "a+b") as handle, _exclusive(handle):
            # A move retired the file this handle locked: open the name again.
            if not _names(handle, path):
                continue
            size = _drop_fragment(handle)
            if size == 0:
                _sync_directory(path.parent)
            held: set[bytes] = set()
            if skip_held and size:
                handle.seek(0)
                held = set(handle.read().split(b"\n"))
            payload = b"".join(line for line in lines if line[:-1] not in held)
            if payload:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            return
    raise OSError(f"The record file {path} kept moving while Lens wrote to it.")


def store_image(directory: pathlib.Path, sha256: str, data: bytes) -> None:
    """Write a PNG under its digest unless the file already holds it."""

    final = directory / f"{sha256}.png"
    try:
        if hashlib.sha256(final.read_bytes()).hexdigest() == sha256:
            return
    except FileNotFoundError:
        pass
    directory.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=directory, prefix=f".{sha256}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, final)
    except BaseException:
        pathlib.Path(temporary).unlink(missing_ok=True)
        raise
    _sync_directory(directory)


def move_record(old: pathlib.Path, new: pathlib.Path) -> None:
    """Move a renamed notebook's record and copy the images it names.

    The old file stays locked until it is empty. A writer that waited on it
    meanwhile finds the name gone and appends under the name it was given.
    Lines the new file already holds are skipped, so a retried move adds
    nothing twice. Images stay in the old folder too, because other records
    there may name them.
    """

    try:
        source = open(old, "r+b")  # noqa: SIM115 - the with below closes it
    except FileNotFoundError:
        return
    with source, _exclusive(source):
        _drop_fragment(source)
        source.seek(0)
        data = source.read()
        if new.parent != old.parent:
            _copy_images(data, old.parent / "images", new.parent / "images")
        new.parent.mkdir(parents=True, exist_ok=True)
        _append_lines(
            new,
            [raw + b"\n" for raw in data.split(b"\n") if raw],
            skip_held=True,
        )
        source.truncate(0)
        source.flush()
        os.fsync(source.fileno())
        # Windows keeps an open file in place. The empty file then holds nothing.
        with suppress(OSError):
            old.unlink()


def _names(handle: IO[bytes], path: pathlib.Path) -> bool:
    """Return whether ``path`` still names the file ``handle`` holds."""

    try:
        named = path.stat()
    except FileNotFoundError:
        return False
    held = os.fstat(handle.fileno())
    return (named.st_dev, named.st_ino) == (held.st_dev, held.st_ino)


def _copy_images(data: bytes, source: pathlib.Path, target: pathlib.Path) -> None:
    for raw in data.splitlines():
        line = parse_line(raw)
        image = line.trace.image if line is not None else None
        if image is None:
            continue
        try:
            png = (source / f"{image.sha256}.png").read_bytes()
        except FileNotFoundError:
            continue
        if hashlib.sha256(png).hexdigest() == image.sha256:
            store_image(target, image.sha256, png)


def _sync_directory(directory: pathlib.Path) -> None:
    """Make a new or replaced entry in ``directory`` survive a power loss."""

    if sys.platform == "win32":
        return
    try:
        descriptor = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _drop_fragment(handle: IO[bytes]) -> int:
    """Truncate an unterminated final line and return the committed size."""

    size = handle.seek(0, os.SEEK_END)
    if size == 0:
        return 0
    start = max(0, size - MAX_LINE_BYTES - 1)
    handle.seek(start)
    tail = handle.read()
    if tail.endswith(b"\n"):
        return size
    end = tail.rfind(b"\n")
    if end < 0 and start > 0:
        # Longer than any line Lens writes: end it so readers skip it whole.
        handle.write(b"\n")
        return size + 1
    committed = start + end + 1 if end >= 0 else 0
    handle.truncate(committed)
    return committed


@contextmanager
def _exclusive(handle: IO[bytes]) -> Generator[None, None, None]:
    deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
    while not _try_lock(handle):
        if time.monotonic() > deadline:
            raise TimeoutError("Another writer held the Lens record for too long.")
        time.sleep(0.02)
    try:
        yield
    finally:
        _unlock(handle)


def _try_lock(handle: IO[bytes]) -> bool:
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        if error.errno in _BUSY:
            return False
        raise
    return True


def _unlock(handle: IO[bytes]) -> None:
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        return
