"""Find the current notebook cells that continue recorded code.

Within the kernel that wrote a line, its cell ID names the cell. marimo
assigns cell IDs by position when it loads a notebook, so across kernels a
recorded cell is followed by its code: the current cell with the same code,
or the cell that holds the most of its statements, defines the same names,
or keeps its ID.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .._notebook.snapshot import RuntimeCell, RuntimeSnapshot
from .._notebook.statements import Statements, statements
from .lines import code_hash


@dataclass(frozen=True, slots=True)
class Code:
    """One observed version of a cell.

    ``hash`` is None when the cell does not exist. ``text`` is None when the
    record did not keep the code for ``hash``. ``kernel`` is None for the
    notebook's current code when no recorded kernel is running.
    """

    kernel: str | None
    cell_id: str
    hash: str | None
    text: str | None
    defs: tuple[str, ...] = ()

    @property
    def unknown(self) -> bool:
        return self.hash is not None and self.text is None


class CurrentCells:
    """The notebook's cells in one snapshot, indexed to follow recorded code.

    ``complete`` is true when the snapshot lists every cell, so a cell that
    is missing is deleted. ``unseen`` names cells the snapshot cannot read.
    ``kernel`` is None when no recorded kernel is running, so every recorded
    cell is followed by its code.
    """

    __slots__ = (
        "_by_defs",
        "_by_hash",
        "_definers",
        "_follows",
        "_holders",
        "_statements",
        "cells",
        "complete",
        "kernel",
        "order",
        "parents",
        "unseen",
    )

    def __init__(self, snapshot: RuntimeSnapshot, *, kernel: str | None) -> None:
        self.kernel = kernel
        self.cells: Mapping[str, RuntimeCell] = snapshot.notebook_cells()
        self.order = {
            cell.id: index
            for index, cell in enumerate((*snapshot.cells, *snapshot.unregistered))
        }
        self.parents: Mapping[str, Sequence[str]] = {
            cell_id: cell.upstream_cell_ids for cell_id, cell in self.cells.items()
        }
        self.complete = (
            snapshot.available and snapshot.document and not snapshot.omitted_cell_count
        )
        self.unseen = snapshot.unseen
        self._statements: dict[str, Statements] = {}
        self._by_hash: dict[str, list[RuntimeCell]] | None = None
        self._holders: dict[str, dict[str, int]] | None = None
        self._definers: dict[str, set[str]] | None = None
        self._by_defs: dict[frozenset[str], set[str]] | None = None
        self._follows: dict[tuple[str, bool, str], tuple[RuntimeCell | None, bool]] = {}

    def follow(self, code: Code) -> tuple[RuntimeCell | None, bool]:
        """Return the current cell that continues ``code``, if one does.

        The flag is true when several current cells match equally, so the cell
        may continue in either of them.
        """

        if code.kernel == self.kernel:
            return self.cells.get(code.cell_id), False
        if code.hash is None:
            return None, False
        key = (code.hash, code.text is None, code.cell_id)
        if key not in self._follows:
            self._follows[key] = self._match(code)
        return self._follows[key]

    def _match(self, code: Code) -> tuple[RuntimeCell | None, bool]:
        """Find the current cell that continues ``code`` from another kernel.

        A cell with the same code wins. Otherwise the cell that holds the most
        recorded statements wins. Among cells that hold equally many, the one
        cell that defines the same names or keeps the recorded cell ID wins.
        A restarted editor keeps cell IDs, and a fresh load may give an ID to
        another cell, so two cells that each carry one of those signals are
        ambiguous. A candidate holds at least half the statements or defines
        the same names.
        """

        if self._by_hash is None:
            self._by_hash = {}
            for cell in self.cells.values():
                self._by_hash.setdefault(code_hash(cell.code), []).append(cell)
        exact = self._by_hash.get(code.hash or "", [])
        if exact:
            if len(exact) == 1:
                return exact[0], False
            same = [cell for cell in exact if cell.id == code.cell_id]
            return (same[0], False) if same else (None, True)
        holders, _definers, by_defs = self._cell_index()
        recorded = Counter(self.parse(code.text).counts) if code.text else Counter()
        total = sum(recorded.values())
        shared: Counter[str] = Counter()
        for key, count in recorded.items():
            for cell_id, held in holders.get(key, {}).items():
                shared[cell_id] += min(count, held)
        named = by_defs.get(frozenset(code.defs), set()) if code.defs else set()
        candidates = {
            cell_id for cell_id, held in shared.items() if held * 2 >= total
        } | named
        if not candidates:
            return None, False
        most = max(shared[cell_id] for cell_id in candidates)
        top = [cell_id for cell_id in candidates if shared[cell_id] == most]
        if len(top) > 1:
            top = [
                cell_id
                for cell_id in top
                if cell_id in named or cell_id == code.cell_id
            ]
        if len(top) != 1:
            return None, True
        return self.cells[top[0]], False

    def moved_to(
        self,
        current: RuntimeCell | None,
        missing: Sequence[str],
        defs: Sequence[str],
    ) -> list[str]:
        """Return other cells that now hold lost statements or lost names."""

        holders, definers, _by_defs = self._cell_index()
        lost_names = set(defs) - set(current.defs if current else ())
        moved = {
            *(cell_id for key in missing for cell_id in holders.get(key, {})),
            *(cell_id for name in lost_names for cell_id in definers.get(name, ())),
        }
        if current is not None:
            moved.discard(current.id)
        return sorted(moved, key=lambda cell_id: self.order[cell_id])

    def _cell_index(
        self,
    ) -> tuple[
        dict[str, dict[str, int]], dict[str, set[str]], dict[frozenset[str], set[str]]
    ]:
        if self._holders is None or self._definers is None or self._by_defs is None:
            self._holders, self._definers, self._by_defs = {}, {}, {}
            for cell in self.cells.values():
                for key, count in self.parse(cell.code).counts.items():
                    self._holders.setdefault(key, {})[cell.id] = count
                for name in cell.defs:
                    self._definers.setdefault(name, set()).add(cell.id)
                self._by_defs.setdefault(frozenset(cell.defs), set()).add(cell.id)
        return self._holders, self._definers, self._by_defs

    def unseen_may_hold(self, code: Code) -> bool:
        """Return whether a cell the snapshot cannot read may continue ``code``."""

        if code.kernel == self.kernel:
            return code.cell_id in self.unseen
        return bool(self.unseen)

    def parse(self, code: str | None) -> Statements:
        text = code or ""
        parsed = self._statements.get(text)
        if parsed is None:
            parsed = self._statements[text] = statements(text)
        return parsed
