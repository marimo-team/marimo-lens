"""Report whether each recorded change still holds in the current notebook.

A change is judged inside its own cell. It holds while every statement it
added occurs in that cell at least as often as right after the request. An
added assignment that a later edit rewrote still holds while the variable it
assigns still reads every name the change wired into it, directly or through
earlier assignments in the cell. A change that only removed statements holds
while none of them come back, and a change that also added code is judged by
what it added, so bringing back code it dropped restores that code's request.
Statements are compared as syntax trees without positions, so formatting and
comments do not count.

The cell is followed from the request to the notebook now, through recorded
requests in the order they resolved. Across kernels a recorded cell continues
in the one change of a later kernel that starts from the code a line left, or,
since saving and reopening a notebook can reformat code, from the same
statements when no other cell of that kernel's baseline held them.
``CurrentCells`` then finds the cell that continues it in the notebook now.

A status is unknown when the record left out code it needs, or when the
snapshot cannot show where the cell is now.
"""

from __future__ import annotations

import threading
from bisect import bisect_right
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import NamedTuple, cast

from .._core.bounds import parse_timestamp
from .._core.types import RecordedChange, RecordedImage, RecordedRequest
from .._notebook.snapshot import RuntimeCell, RuntimeSnapshot, cell_name, upstream_order
from .._notebook.statements import Flows, Shape, flows, statement_shape
from .cells import Code, CurrentCells
from .lines import RecordChange, RecordLine, code_hash

MAX_HISTORY_ROWS = 256
MAX_REPORTED_STATEMENTS = 8
MAX_MOVED_TO = 16

UNRECORDED = "unrecorded"
# How the brief and checks name the author of an ``UNRECORDED`` undo.
UNRECORDED_EDIT = "an edit not yet in the record, such as one for an open request"


@dataclass(frozen=True, slots=True)
class _Step:
    code: Code
    by: str


class _Key(NamedTuple):
    """One recorded version of a cell.

    ``code_hash`` is None when the line saw no code for the cell.
    """

    line_index: int
    cell_id: str
    code_hash: str | None


@dataclass(frozen=True, slots=True)
class _Node:
    """One recorded version of a cell and the recorded change that continues it.

    ``gap`` is the code the next request started from when an unrecorded edit
    came between them.
    """

    code: Code
    by: str
    gap: Code | None
    next: _Key | None


@dataclass(frozen=True, slots=True)
class _End:
    """Where a followed cell is now.

    ``now`` is the cell's code in the snapshot, with a None hash for a deleted
    cell. It is None when the snapshot cannot show the cell: the runtime was
    unavailable, the snapshot omitted cells, or the snapshot cannot list every
    cell of marimo's notebook document, so a cell with a syntax error would
    look deleted.
    """

    last: Code
    current: RuntimeCell | None
    now: Code | None


@dataclass(frozen=True, slots=True)
class _Chain:
    """The recorded versions of one cell, in order, and where the cell is now.

    ``steps`` holds each version and each unrecorded gap. Requests that change
    the cell later share the chain, so it is walked once.
    """

    steps: list[_Step]
    end: _End


class RecordStatus:
    """Join recorded requests with one snapshot of the current notebook.

    Each cell's recorded versions are walked once into a chain, each line's
    row is computed on first need, and each target's rows once, so the brief,
    History, and ``history()`` share them. Callers copy the rows. ``kernel``
    is the running kernel, or None when no recorded kernel is running.
    """

    __slots__ = (
        "_befores",
        "_by_before",
        "_by_cell",
        "_by_shape",
        "_chains",
        "_changes",
        "_codes",
        "_current",
        "_kernel",
        "_lines",
        "_lock",
        "_nodes",
        "_opened",
        "_positions",
        "_resolved",
        "_rows",
        "_targets",
    )

    def __init__(
        self,
        lines: Sequence[RecordLine],
        snapshot: RuntimeSnapshot,
        *,
        kernel: str | None,
    ) -> None:
        # A line is appended when its write lands, which can trail a later
        # resolution in another Lens. Status follows resolution order.
        timed = sorted(
            ((parse_timestamp(line.resolved_at), line) for line in lines),
            key=lambda pair: pair[0],
        )
        self._lines = tuple(line for _, line in timed)
        self._positions = {id(line): index for index, line in enumerate(self._lines)}
        self._kernel = kernel
        self._current = CurrentCells(snapshot, kernel=kernel)
        self._opened = [parse_timestamp(line.opened_at) for line in self._lines]
        self._resolved = [resolved for resolved, _ in timed]
        self._codes = [{code.hash: code for code in line.codes} for line in self._lines]
        self._changes = [
            {change.cell_id: change for change in line.changes} for line in self._lines
        ]
        self._befores: list[dict[str, RecordChange]] = []
        self._by_cell: dict[tuple[str | None, str], list[int]] = {}
        self._by_before: dict[str, list[int]] = {}
        for index, line in enumerate(self._lines):
            counts = Counter(change.before for change in line.changes)
            befores = {
                change.before: change
                for change in line.changes
                if change.before is not None
                and counts[change.before] == 1
                and change.before not in line.baseline.repeated
            }
            self._befores.append(befores)
            for value in befores:
                self._by_before.setdefault(value, []).append(index)
            for change in line.changes:
                key = (line.kernel, change.cell_id)
                self._by_cell.setdefault(key, []).append(index)
        self._by_shape: dict[Shape, list[tuple[int, RecordChange]]] | None = None
        self._nodes: dict[_Key, _Node] = {}
        self._chains: dict[_Key, tuple[_Chain, int]] = {}
        self._rows: dict[int, tuple[RecordedRequest, frozenset[str]]] = {}
        self._targets: dict[tuple[str, ...] | None, list[RecordedRequest]] = {}
        self._lock = threading.Lock()

    @property
    def cells(self) -> Mapping[str, RuntimeCell]:
        """The notebook's cells by ID, as the snapshot this status judges showed them."""

        return self._current.cells

    @staticmethod
    def inputs(snapshot: RuntimeSnapshot) -> object:
        """Return the parts of ``snapshot`` a status depends on, for comparison."""

        return (
            snapshot.available,
            snapshot.document,
            snapshot.unseen,
            snapshot.omitted_cell_count,
            tuple(
                (cell.id, cell.code, cell.defs, cell.name, cell.upstream_cell_ids)
                for cell in snapshot.cells
            ),
            tuple((cell.id, cell.code, cell.name) for cell in snapshot.unregistered),
        )

    def history(self, cell_ids: Sequence[str] | None) -> list[RecordedRequest]:
        """Return requests in resolution order, at most the newest ``MAX_HISTORY_ROWS``.

        With ``cell_ids``, keep the requests whose changed or traced cells now
        are those cells or their upstream closure, or whose lost code now
        lives there.
        """

        key = None if cell_ids is None else tuple(cell_ids)
        with self._lock:
            rows = self._targets.get(key)
            if rows is None:
                closure = (
                    None
                    if key is None
                    else {*key, *upstream_order(key, self._current.parents)}
                )
                # Newest first, so only the rows a target returns are computed.
                rows = []
                for index in reversed(range(len(self._lines))):
                    row, reached = self._row(index)
                    if closure is None or closure & reached:
                        rows.append(row)
                        if len(rows) == MAX_HISTORY_ROWS:
                            break
                rows.reverse()
                self._targets[key] = rows
            return rows

    def requests(self) -> list[tuple[RecordLine, RecordedRequest]]:
        """Return every line with its row, in resolution order."""

        with self._lock:
            return [
                (line, self._row(index)[0]) for index, line in enumerate(self._lines)
            ]

    def _row(self, index: int) -> tuple[RecordedRequest, frozenset[str]]:
        row = self._rows.get(index)
        if row is None:
            row = self._rows[index] = self._request(index)
        return row

    def trace(self, line: RecordLine) -> dict[str, str | None]:
        """Map each cell a line pointed at to the current cell that continues it."""

        index = self._positions[id(line)]
        with self._lock:
            return {
                cell.cell_id: self._now(_Key(index, cell.cell_id, cell.code))
                for cell in line.trace.cells
            }

    def gone(self, line: RecordLine) -> list[str]:
        """Return the cells a line pointed at that the notebook no longer holds.

        A cell counts only when the snapshot establishes its absence, so a
        cell the snapshot cannot read or follow is never gone.
        """

        index = self._positions[id(line)]
        with self._lock:
            return [
                cell.cell_id
                for cell in line.trace.cells
                if self._gone(_Key(index, cell.cell_id, cell.code))
            ]

    def _gone(self, key: _Key) -> bool:
        if key.code_hash is None:
            return (
                self._lines[key.line_index].kernel == self._kernel
                and self._current.complete
                and key.cell_id not in self._current.cells
                and key.cell_id not in self._current.unseen
            )
        end = self._chain(key)[0].end
        return end.current is None and end.now is not None and end.now.hash is None

    def _request(self, index: int) -> tuple[RecordedRequest, frozenset[str]]:
        """Return one line's row and every current cell it reaches."""

        line = self._lines[index]
        changes: list[RecordedChange] = []
        reached: set[str] = set()
        for change in line.changes:
            row, moved = self._change(index, change)
            changes.append(row)
            reached.update(moved)
            if row["cellId"]:
                reached.add(row["cellId"])
        traced = [
            cell_id
            for cell in line.trace.cells
            if (cell_id := self._now(_Key(index, cell.cell_id, cell.code))) is not None
        ]
        reached.update(traced)
        request = RecordedRequest(
            id=line.id,
            channel=line.channel,
            label=line.label,
            note=line.note,
            summary=line.summary,
            openedAt=line.opened_at,
            resolvedAt=line.resolved_at,
            cellIds=list(dict.fromkeys(traced)),
            changes=changes,
            concurrent=list(line.concurrent),
            image=self._image(line),
        )
        return request, frozenset(reached)

    def _image(self, line: RecordLine) -> RecordedImage | None:
        image = line.trace.image
        if image is None:
            return None
        # Rows outlive the files they name, so callers fill in ``path``.
        return cast(
            "RecordedImage",
            {**image.model_dump(mode="json", by_alias=True), "path": None},
        )

    def _change(
        self, index: int, change: RecordChange
    ) -> tuple[RecordedChange, list[str]]:
        """Return a change's row and every other cell that holds its lost code."""

        before = self._version(index, change.cell_id, change.before)
        start = _Key(index, change.cell_id, change.after)
        after = self._node(start).code
        chain, position = self._chain(start)
        end = chain.end
        current = end.current
        row = RecordedChange(
            cellId=current.id if current else None,
            name=(current.name if current else None) or cell_name(change.name),
            status="unknown",
            undoneBy=None,
            movedTo=[],
            missing=[],
            restored=[],
        )
        if before.unknown or after.unknown or end.now is None:
            return row, []

        before_statements = self._current.parse(before.text)
        after_statements = self._current.parse(after.text)
        expected = after_statements.counts
        added = Counter(expected) - Counter(before_statements.counts)
        removed = Counter(before_statements.counts) - Counter(expected)
        brought = _brought_in(added, flows(before.text or ""), flows(after.text or ""))

        def lost(code: Code) -> list[str]:
            counts = self._current.parse(code.text).counts
            depends = flows(code.text or "").depends
            return [
                key
                for key in added
                if counts.get(key, 0) < expected.get(key, 0)
                and not _still_reads(brought.get(key), depends)
            ]

        def came_back(code: Code) -> list[str]:
            counts = self._current.parse(code.text).counts
            return [key for key in removed if counts.get(key, 0) > expected.get(key, 0)]

        # A change that added code is judged by what it added, so bringing
        # back code it dropped restores that code's own request.
        def holds(code: Code) -> bool:
            return not lost(code) and (bool(added) or not came_back(code))

        if holds(end.now):
            row["status"] = "in_force"
            return row, []

        # The change stopped holding right after the last step where it held.
        # A step after that whose code the record left out may be where it
        # stopped, so the undo has no known author.
        last = self._last_holding(chain, position, holds)
        undone_by: str | None = None
        if not any(step.code.unknown for step in chain.steps[last + 1 :]):
            undone_by = (
                chain.steps[last + 1].by if last + 1 < len(chain.steps) else UNRECORDED
            )

        missing = lost(end.now)
        restored = came_back(end.now)
        texts = {**before_statements.texts, **after_statements.texts}
        moved = self._current.moved_to(current, missing, after.defs)
        row["status"] = "undone"
        row["undoneBy"] = undone_by
        row["missing"] = [texts[key] for key in missing[:MAX_REPORTED_STATEMENTS]]
        row["restored"] = [texts[key] for key in restored[:MAX_REPORTED_STATEMENTS]]
        row["movedTo"] = moved[:MAX_MOVED_TO]
        return row, moved

    def _node(self, key: _Key) -> _Node:
        """Return the recorded version ``key`` names and the change that continues it.

        An edit between two recorded requests is unrecorded when the later
        request started from other code and opened after the earlier one
        resolved. A request that opened sooner started from older code.
        """

        node = self._nodes.get(key)
        if node is not None:
            return node
        index = key.line_index
        code = self._version(index, key.cell_id, key.code_hash)
        gap: Code | None = None
        next_key: _Key | None = None
        found = self._next(index, code)
        if found is not None:
            position, change = found
            if (
                change.before != code.hash
                and self._opened[position] >= self._resolved[index]
            ):
                gap = self._version(position, change.cell_id, change.before)
            next_key = _Key(position, change.cell_id, change.after)
        node = self._nodes[key] = _Node(code, self._lines[index].id, gap, next_key)
        return node

    def _chain(self, key: _Key) -> tuple[_Chain, int]:
        """Return the chain that follows ``key`` and the position of ``key`` in it.

        Chains for every recorded change are built once, oldest first, so all
        the changes to one cell share the chain of its first change.
        """

        if not self._chains:
            for index, line in enumerate(self._lines):
                for change in line.changes:
                    self._walk(_Key(index, change.cell_id, change.after))
        return self._chains.get(key) or self._walk(key)

    def _walk(self, key: _Key) -> tuple[_Chain, int]:
        found = self._chains.get(key)
        if found is not None:
            return found
        steps: list[_Step] = []
        starts: list[tuple[_Key, int]] = []
        tail: tuple[_Chain, int] | None = None
        while True:
            node = self._node(key)
            starts.append((key, len(steps)))
            steps.append(_Step(node.code, node.by))
            if node.next is None:
                break
            if node.gap is not None:
                steps.append(_Step(node.gap, UNRECORDED))
            tail = self._chains.get(node.next)
            if tail is not None:
                break
            key = node.next
        if tail is None:
            chain = _Chain(steps, self._settle(steps[-1].code))
        else:
            joined, offset = tail
            chain = _Chain(steps + joined.steps[offset:], joined.end)
        for walked, position in starts:
            self._chains[walked] = (chain, position)
        return self._chains[starts[0][0]]

    def _settle(self, code: Code) -> _End:
        """Return where the cell whose last recorded version is ``code`` is now."""

        current, ambiguous = self._current.follow(code)
        now: Code | None = None
        if current is not None:
            now = Code(
                self._kernel,
                current.id,
                code_hash(current.code),
                current.code,
                current.defs,
            )
        # Code the record left out has no statements to follow, so a cell that
        # ended there counts as gone only when it ended deleted.
        elif code.hash is None or (
            not code.unknown
            and self._current.complete
            and not ambiguous
            and not self._current.unseen_may_hold(code)
        ):
            now = Code(self._kernel, code.cell_id, None, None)
        return _End(code, current, now)

    @staticmethod
    def _last_holding(
        chain: _Chain, position: int, holds: Callable[[Code], bool]
    ) -> int:
        """Return the last step at or after ``position`` where a change holds."""

        for index in range(len(chain.steps) - 1, position, -1):
            code = chain.steps[index].code
            if not code.unknown and holds(code):
                return index
        return position

    def _next(self, index: int, code: Code) -> tuple[int, RecordChange] | None:
        """Return the first change after line ``index`` that continues ``code``.

        That is the next change to the same cell ID in the kernel that wrote
        ``code``. When that kernel never changes the cell again, it is the
        earliest change in another kernel that starts from ``code``, from code
        no other cell of its baseline held, or that starts from the same
        statements, which no other cell of its baseline held.
        """

        same = self._by_cell.get((code.kernel, code.cell_id), [])
        at = bisect_right(same, index)
        if at < len(same):
            return same[at], self._changes[same[at]][code.cell_id]
        if code.hash is None:
            return None
        found: tuple[int, RecordChange] | None = None
        others = self._by_before.get(code.hash, [])
        for other in others[bisect_right(others, index) :]:
            if self._lines[other].kernel != code.kernel:
                found = other, self._befores[other][code.hash]
                break
        if code.text is None:
            return found
        alike = self._shapes().get(statement_shape(code.text), [])
        for other, change in alike[
            bisect_right(alike, index, key=lambda item: item[0]) :
        ]:
            if found is not None and other >= found[0]:
                break
            if self._lines[other].kernel != code.kernel:
                return other, change
        return found

    def _shapes(self) -> dict[Shape, list[tuple[int, RecordChange]]]:
        """Index each line's starting code by its statements, in line order.

        Code with no statements, and code whose statements another cell of the
        line's baseline held, stays out, since it names no one cell.
        """

        if self._by_shape is None:
            self._by_shape = {}
            for index, befores in enumerate(self._befores):
                alike = self._lines[index].baseline.alike
                for value, change in befores.items():
                    stored = self._codes[index].get(value)
                    if stored is None or value in alike:
                        continue
                    shape = statement_shape(stored.text)
                    if shape:
                        self._by_shape.setdefault(shape, []).append((index, change))
        return self._by_shape

    def _now(self, key: _Key) -> str | None:
        """Return the current cell that continues a traced cell, if known."""

        if key.code_hash is None:
            same_kernel = self._lines[key.line_index].kernel == self._kernel
            if same_kernel and (
                key.cell_id in self._current.cells
                or key.cell_id in self._current.unseen
                or not self._current.complete
            ):
                return key.cell_id
            return None
        end = self._chain(key)[0].end
        if end.current is not None:
            return end.current.id
        # A cell of this kernel that the snapshot omitted keeps its ID.
        if end.now is None and end.last.kernel == self._kernel:
            return end.last.cell_id
        return None

    def _version(self, index: int, cell_id: str, value: str | None) -> Code:
        stored = self._codes[index].get(value) if value is not None else None
        return Code(
            self._lines[index].kernel,
            cell_id,
            value,
            stored.text if stored else None,
            tuple(stored.defs) if stored else (),
        )


def _brought_in(
    added: Mapping[str, int], before: Flows, after: Flows
) -> dict[str, tuple[frozenset[str], frozenset[str]]]:
    """Return, for each added assignment, what it assigns and the names it wired in.

    The names are those the assignment reads that the assignments it replaced
    did not. An assignment that brings in no name, such as a changed constant,
    has no entry and holds only as written.
    """

    brought: dict[str, tuple[frozenset[str], frozenset[str]]] = {}
    for key in added:
        found = after.reads.get(key)
        if found is None:
            continue
        targets, names = found
        replaced = frozenset[str]().union(
            *(read for assigned, read in before.reads.values() if assigned & targets)
        )
        if names - replaced:
            brought[key] = (targets, names - replaced)
    return brought


def _still_reads(
    brought: tuple[frozenset[str], frozenset[str]] | None,
    depends: Mapping[str, frozenset[str]],
) -> bool:
    """Say whether a rewritten assignment still feeds in what its change brought."""

    if brought is None:
        return False
    targets, names = brought
    return all(target in depends and names <= depends[target] for target in targets)
