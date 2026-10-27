from __future__ import annotations

import errno
import json
import os
import pathlib
import stat
import sys
import threading
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

import pytest
from marimo_lens import LensError
from marimo_lens._marimo.adapter import MarimoRuntimeAdapter
from marimo_lens._notebook.snapshot import RuntimeSnapshot
from marimo_lens._record import file_journal, files
from marimo_lens._record.file_journal import FileJournal
from marimo_lens._record.journal import JournalFull, MemoryJournal
from marimo_lens._record.lines import RecordLine, RecordRead, serialize_line

from tests.support.browser import RecordBrowserLens
from tests.support.factories import (
    cell,
    png,
    record_line,
    selection,
    snapshot,
)
from tests.support.kernel import SALES, FakeNotebook


def _line(notebook: RuntimeSnapshot, request_id: str) -> RecordLine:
    return record_line(request_id, notebook, notebook, trace=("cell-a",))


def _ids(path: pathlib.Path) -> list[str]:
    # Windows cannot delete an open file, so a moved record leaves an empty one.
    if not path.exists():
        return []
    return [
        json.loads(text)["id"] for text in path.read_text(encoding="utf-8").splitlines()
    ]


def test_an_interrupted_write_is_dropped_before_the_next_line(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    path = tmp_path / "__marimo__" / "lens" / "sales.py.jsonl"
    path.parent.mkdir(parents=True)
    path.write_text('{"schema":"marimo-lens.record/1","id":"cut')
    lens = RecordBrowserLens()
    lens.put(selection())

    lens.resolve("selection-1", expected_revision=lens.revision)

    assert _ids(path) == ["selection-1"]


def test_a_line_without_its_newline_is_not_committed(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    path.write_bytes(serialize_line(_line(notebook, "chat-1"))[:-1])

    assert _read(path).lines == ()


def test_a_reader_sees_lines_another_writer_appends(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    reader, writer = FileJournal(lambda: path), FileJournal(lambda: path)
    writer.accept([_line(notebook, "chat-1")], {})
    first = reader.read()
    writer.accept([_line(notebook, "chat-2")], {})

    second = reader.read()

    assert [line.id for line in first.lines] == ["chat-1"]
    assert [line.id for line in second.lines] == ["chat-1", "chat-2"]
    assert reader.read().lines is second.lines


def test_a_record_replaced_on_disk_reads_whole_again(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    journal = FileJournal(lambda: path)
    journal.accept([_line(notebook, "chat-1")], {})
    journal.read()
    replacement = tmp_path / "restored.jsonl"
    replacement.write_bytes(
        serialize_line(_line(notebook, "chat-2"))
        + serialize_line(_line(notebook, "chat-3"))
    )
    os.replace(replacement, path)

    assert [line.id for line in journal.read().lines] == ["chat-2", "chat-3"]


def test_a_record_edited_in_place_reads_whole_again(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    journal = FileJournal(lambda: path)
    journal.accept([_line(notebook, "chat-1"), _line(notebook, "chat-2")], {})
    journal.read()
    stamp = path.stat().st_mtime_ns
    path.write_bytes(path.read_bytes().replace(b'"chat-1"', b'"chat-9"'))
    os.utime(path, ns=(stamp + 1_000_000_000, stamp + 1_000_000_000))

    assert [line.id for line in journal.read().lines] == ["chat-9", "chat-2"]


def test_a_read_window_that_starts_on_a_line_keeps_that_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    lines = [serialize_line(_line(notebook, f"chat-{index}")) for index in range(3)]
    path.write_bytes(b"".join(lines))
    monkeypatch.setattr(files, "MAX_READ_BYTES", len(lines[1]) + len(lines[2]))

    read = _read(path)

    assert [line.id for line in read.lines] == ["chat-1", "chat-2"]
    assert (read.skipped, read.truncated) == (0, True)


def test_a_line_whose_code_disagrees_with_its_hash_is_skipped(
    tmp_path: pathlib.Path,
) -> None:
    path = tmp_path / "sales.py.jsonl"
    line = record_line("chat-1", {"cell-a": "x = 1"}, {"cell-a": "x = 2"})
    path.write_bytes(serialize_line(line).replace(b'"x = 2"', b'"x = 3"'))

    read = _read(path)

    assert (read.lines, read.skipped) == ((), 1)


def test_concurrent_writers_append_whole_lines(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "__marimo__" / "lens" / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1\n" + "# filler\n" * 8_000))

    def write(writer: int) -> None:
        journal = FileJournal(lambda: path)
        for index in range(25):
            journal.accept([_line(notebook, f"chat-{writer}-{index}")], {})

    threads = [threading.Thread(target=write, args=(writer,)) for writer in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(_ids(path)) == sorted(
        f"chat-{writer}-{index}" for writer in range(4) for index in range(25)
    )


def test_a_retry_after_other_writers_does_not_duplicate_a_written_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1\n" + "# filler\n" * 20_000))
    journal = FileJournal(lambda: path)
    fsync = files.os.fsync
    calls = 0

    # The write reaches the file, then reports failure.
    def fail_once(fd: int) -> None:
        nonlocal calls
        if stat.S_ISREG(os.fstat(fd).st_mode):
            calls += 1
            if calls == 1:
                raise OSError("disk went away")
        fsync(fd)

    monkeypatch.setattr(files.os, "fsync", fail_once)
    assert journal.accept([_line(notebook, "chat-1")], {}).status == "failed"
    other = FileJournal(lambda: path)
    for index in range(40):
        other.accept([_line(notebook, f"other-{index}")], {})
    assert path.stat().st_size > 5 * 1024 * 1024

    assert journal.accept([_line(notebook, "chat-2")], {}).status == "saved"

    ids = _ids(path)
    assert ids.count("chat-1") == 1
    assert ids[-1] == "chat-2"


def test_an_unsaved_notebook_refuses_requests_past_its_pending_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(file_journal, "MAX_PENDING_LINES", 2)
    FakeNotebook(monkeypatch, None, dict(SALES))
    lens = RecordBrowserLens()
    first, second, third = (lens.open_request(f"Request {i}") for i in range(3))
    lens.resolve([first, second], expected_revision=lens.revision)

    with pytest.raises(LensError) as error:
        lens.resolve(third, expected_revision=lens.revision)

    assert error.value.code == "record_full"
    assert "Save the notebook" in str(error.value)
    assert [chat["id"] for chat in lens.context().references["chatRequests"]] == [third]


@pytest.mark.parametrize("host", ["pyodide", "app", "session"])
def test_a_record_kept_in_memory_answers_history_and_images(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, host: str
) -> None:
    if host == "pyodide":
        monkeypatch.setattr(sys, "platform", "emscripten")
        # A blocked fcntl import fails the test if Lens reaches for file locking.
        monkeypatch.setitem(sys.modules, "fcntl", None)
    mode = "run" if host == "app" else "edit"
    FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES), mode=mode)
    lens = RecordBrowserLens(record={"keep": "session"} if host == "session" else True)
    data = png()
    lens.put(selection(output_cell_id="cell-chart"), image=data)
    lens.resolve("selection-1", expected_revision=lens.revision)
    [entry] = lens.history_entries()

    lens.command("history.image", {"sha256": entry["image"]["sha256"]})
    context = lens.context()

    assert lens.sent[-1][1] == [data]
    assert context.references["notebook"]["record"] == {
        "status": "session",
        "reason": "Kept in this notebook runtime until it restarts.",
    }
    assert [row["id"] for row in context.history()] == ["selection-1"]
    assert not (tmp_path / "__marimo__").exists()


def test_constructing_a_lens_reads_no_record_and_no_notebook(
    monkeypatch: pytest.MonkeyPatch, notebook: FakeNotebook
) -> None:
    from marimo_lens._marimo import adapter

    reads: list[str] = []
    for name in ("notebook", "snapshot"):
        original = getattr(MarimoRuntimeAdapter, name)

        def counted(self: object, *args: object, _name: str = name, _f=original):
            reads.append(_name)
            return _f(self, *args)

        monkeypatch.setattr(MarimoRuntimeAdapter, name, counted)
    locate = adapter.record_path
    monkeypatch.setattr(
        adapter, "record_path", lambda: reads.append("record_path") or locate()
    )

    RecordBrowserLens(displayed=False)

    assert reads == []


def test_a_record_line_that_cannot_be_built_leaves_the_request_open(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    import marimo_lens._session.session as session_module

    lens = RecordBrowserLens()
    lens.put(selection())

    def refuse(*_args: object, **_kwargs: object) -> RecordLine:
        raise RuntimeError("line too strange")

    monkeypatch.setattr(session_module, "build_line", refuse)

    with pytest.raises(RuntimeError, match="line too strange"):
        lens.resolve("selection-1", expected_revision=lens.revision)

    assert [item["id"] for item in lens.synced_state()["selections"]] == ["selection-1"]
    assert not (tmp_path / "__marimo__").exists()


def test_a_renamed_notebook_keeps_its_record_and_images(
    tmp_path: pathlib.Path, notebook: FakeNotebook
) -> None:
    lens = RecordBrowserLens()
    data = png()
    lens.resolve(lens.open_request("Explain the dip"), expected_revision=0)
    lens.put(selection(output_cell_id="cell-chart"), image=data)
    lens.resolve("selection-1", expected_revision=lens.revision)
    (tmp_path / "reports").mkdir()

    notebook.context.globals["__file__"] = str(tmp_path / "reports" / "revenue.py")
    [chat, row] = lens.context().history()

    assert _ids(tmp_path / "__marimo__" / "lens" / "sales.py.jsonl") == []
    moved = tmp_path / "reports" / "__marimo__" / "lens" / "revenue.py.jsonl"
    assert len(_read(moved).lines) == 2
    assert chat["image"] is None
    assert row["image"] is not None and row["image"]["path"] is not None
    image = pathlib.Path(row["image"]["path"])
    assert image.read_bytes() == data
    assert image.is_relative_to(tmp_path / "reports")


def test_a_line_another_journal_appends_during_a_move_is_kept(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    old, new = tmp_path / "sales.py.jsonl", tmp_path / "revenue.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    located = old
    mover = FileJournal(lambda: located)
    writer = FileJournal(lambda: old)
    mover.accept([_line(notebook, "before")], {})
    unlock = files._unlock

    # The other journal appends as soon as the move releases the old file.
    def release(handle: Any) -> None:
        unlock(handle)
        if pathlib.Path(handle.name) == old:
            monkeypatch.setattr(files, "_unlock", unlock)
            writer.accept([_line(notebook, "concurrent")], {})

    monkeypatch.setattr(files, "_unlock", release)
    located = new
    moved = mover.read()

    assert [line.id for line in moved.lines] == ["before"]
    assert _ids(old) == ["concurrent"]


def test_a_record_that_cannot_move_keeps_taking_lines_under_its_old_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    old, new = tmp_path / "sales.py.jsonl", tmp_path / "revenue.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    located = old
    journal = FileJournal(lambda: located)
    journal.accept([_line(notebook, "before")], {})
    move = files.move_record

    def busy(source: pathlib.Path, target: pathlib.Path) -> None:
        raise TimeoutError("the record is locked")

    monkeypatch.setattr(files, "move_record", busy)
    located = new
    health = journal.accept([_line(notebook, "during")], {})
    waiting = journal.read()
    monkeypatch.setattr(files, "move_record", move)
    moved = journal.read()

    assert health.status == "failed"
    assert [line.id for line in waiting.lines] == ["before", "during"]
    assert [line.id for line in moved.lines] == ["before", "during"]
    assert (_ids(new), _ids(old)) == (["before", "during"], [])


def test_a_retried_move_writes_each_line_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    old, new = tmp_path / "sales.py.jsonl", tmp_path / "revenue.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    located = old
    journal = FileJournal(lambda: located)
    journal.accept([_line(notebook, "before")], {})
    fsync = files.os.fsync
    failed = False

    # The new file takes the lines, then its sync fails.
    def fail_once(fd: int) -> None:
        nonlocal failed
        if not failed and stat.S_ISREG(os.fstat(fd).st_mode):
            failed = True
            raise OSError("disk went away")
        fsync(fd)

    monkeypatch.setattr(files.os, "fsync", fail_once)
    located = new
    first = journal.read()
    second = journal.read()

    assert (first.health.status, second.health.status) == ("failed", "saved")
    assert (_ids(new), _ids(old)) == (["before"], [])


def test_a_move_into_a_record_another_move_retired_keeps_every_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    a, b, c = (tmp_path / f"{name}.py.jsonl" for name in "abc")
    notebook = snapshot(cell("cell-a", code="x = 1"))
    located = {"a": a, "b": b}
    first = FileJournal(lambda: located["a"])
    second = FileJournal(lambda: located["b"])
    first.accept([_line(notebook, "A")], {})
    second.accept([_line(notebook, "B")], {})
    located.update(a=b, b=c)
    exclusive = files._exclusive
    second_holds_b = threading.Event()
    first_opened_b = threading.Event()

    # The second move holds b while the first move opens b and waits for it.
    @contextmanager
    def scheduled(handle: Any) -> Generator[None]:
        mover = threading.current_thread().name
        if mover == "first" and pathlib.Path(handle.name) == b:
            first_opened_b.set()
        with exclusive(handle):
            if mover == "second" and pathlib.Path(handle.name) == b:
                second_holds_b.set()
                assert first_opened_b.wait(5)
            yield

    monkeypatch.setattr(files, "_exclusive", scheduled)
    reads: dict[str, RecordRead] = {}
    moves = [
        threading.Thread(
            name="second", target=lambda: reads.update(second=second.read())
        ),
        threading.Thread(name="first", target=lambda: reads.update(first=first.read())),
    ]
    moves[0].start()
    assert second_holds_b.wait(5)
    moves[1].start()
    for move in moves:
        move.join(10)

    assert sorted(_ids(b) + _ids(c)) == ["A", "B"]
    assert {name: read.health.status for name, read in reads.items()} == {
        "first": "saved",
        "second": "saved",
    }


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX hard links")
def test_an_append_waiting_through_a_move_follows_the_record_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    old, new = tmp_path / "sales.py.jsonl", tmp_path / "revenue.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    located = old
    mover = FileJournal(lambda: located)
    writer = FileJournal(lambda: old)
    mover.accept([_line(notebook, "before")], {})
    # Another link keeps the old file's inode alive after the move removes it.
    os.link(old, tmp_path / "backup.jsonl")
    exclusive = files._exclusive
    mover_holds_old = threading.Event()
    writer_opened_old = threading.Event()

    # The writer opens the old file while the move holds it.
    @contextmanager
    def scheduled(handle: Any) -> Generator[None]:
        name = threading.current_thread().name
        if name == "writer" and not writer_opened_old.is_set():
            writer_opened_old.set()
        with exclusive(handle):
            if name == "mover" and pathlib.Path(handle.name) == old:
                mover_holds_old.set()
                assert writer_opened_old.wait(5)
            yield

    monkeypatch.setattr(files, "_exclusive", scheduled)
    located = new
    threads = [
        threading.Thread(name="mover", target=mover.read),
        threading.Thread(
            name="writer",
            target=lambda: writer.accept([_line(notebook, "concurrent")], {}),
        ),
    ]
    threads[0].start()
    assert mover_holds_old.wait(5)
    threads[1].start()
    for thread in threads:
        thread.join(10)

    assert [line.id for line in writer.read().lines] == ["concurrent"]
    assert _ids(new) == ["before"]


@pytest.mark.skipif(sys.platform == "win32", reason="fcntl locks")
def test_a_file_system_without_locks_fails_the_write(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path
) -> None:
    import fcntl

    def unsupported(fd: int, operation: int) -> None:
        raise OSError(errno.ENOTSUP, "Operation not supported")

    monkeypatch.setattr(fcntl, "flock", unsupported)
    path = tmp_path / "sales.py.jsonl"
    journal = FileJournal(lambda: path)
    notebook = snapshot(cell("cell-a", code="x = 1"))

    health = journal.accept([_line(notebook, "chat-1")], {})

    assert health.status == "failed"
    assert health.reason is not None
    assert "not supported" in health.reason
    assert [line.id for line in journal.read().lines] == ["chat-1"]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_a_failed_read_is_reported_until_the_record_reads_again(
    tmp_path: pathlib.Path,
) -> None:
    path = tmp_path / "sales.py.jsonl"
    notebook = snapshot(cell("cell-a", code="x = 1"))
    FileJournal(lambda: path).accept([_line(notebook, "chat-1")], {})
    journal = FileJournal(lambda: path)

    path.chmod(0)
    try:
        failed = journal.read()
    finally:
        path.chmod(0o644)
    recovered = journal.read()

    assert (failed.health.status, failed.lines) == ("failed", ())
    assert failed.error is not None
    assert (recovered.health.status, recovered.error) == ("saved", None)
    assert [line.id for line in recovered.lines] == ["chat-1"]


def test_one_resolution_fits_even_past_the_pending_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(file_journal, "MAX_PENDING_BYTES", 10)
    notebook = snapshot(cell("cell-a", code="x = 1"))
    journal = FileJournal(lambda: None)

    journal.accept([_line(notebook, "chat-1"), _line(notebook, "chat-2")], {})

    with pytest.raises(JournalFull):
        journal.accept([_line(notebook, "chat-3")], {})


def test_a_memory_journal_drops_whole_resolutions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._record.journal as journal_module

    monkeypatch.setattr(journal_module, "MAX_MEMORY_LINES", 3)
    notebook = snapshot(cell("cell-a", code="x = 1"))
    journal = MemoryJournal()
    journal.accept([_line(notebook, "chat-1"), _line(notebook, "chat-2")], {})
    journal.accept([_line(notebook, "chat-3"), _line(notebook, "chat-4")], {})

    read = journal.read()

    assert [line.id for line in read.lines] == ["chat-3", "chat-4"]
    assert read.health.reason is not None
    assert "2 oldest requests" in read.health.reason


def _read(path: pathlib.Path) -> RecordRead:
    return FileJournal(lambda: path).read()
