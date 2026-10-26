"""Build the lines of the notebook's record of resolved requests.

Each line is one resolved request and carries every code text it refers to,
so a line stays readable when earlier lines were lost or never written. A
journal stores the lines.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    Field,
    StringConstraints,
    TypeAdapter,
    model_validator,
)
from pydantic import ValidationError as PydanticValidationError

from .._core.bounds import (
    MAX_ERROR,
    AttentionText,
    CellId,
    Identifier,
    NoteText,
    PositiveSafeInteger,
    Revision,
    SelectionLabel,
    Sha256,
    TimestampText,
    utf16_text,
)
from .._core.types import RecordReference
from .._notebook.snapshot import RuntimeCell, RuntimeSnapshot
from .._notebook.statements import statement_shape
from .._schema.model import TransportModel
from .._schema.selection import SelectionAnchor, SelectionTarget, TargetInfo
from .._selection.state import SelectionRecord

SCHEMA = "marimo-lens.record/1"

MAX_CHANGED_CELLS = 64
MAX_TRACE_CELLS = 64
MAX_CODE_TEXT = 256 * 1024
MAX_LINE_BYTES = 4 * 1024 * 1024

Channel: TypeAlias = Literal["selection", "chat"]
CodeHash: TypeAlias = Annotated[
    str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{16}$")
]
_Name: TypeAlias = Annotated[str, StringConstraints(strict=True, max_length=256)]
_Reason: TypeAlias = Annotated[str, StringConstraints(strict=True, max_length=500)]


def code_hash(code: str) -> str:
    """Return the record address of one code text: marimo's ``code_hash``.

    marimo's host protocol names a cell's code by the same value, so record
    lines and Lens references join with what host clients read.
    """

    digest = hashlib.sha256(code.encode("utf-8", "surrogatepass")).hexdigest()
    return digest[:16]


class RecordCode(TransportModel):
    hash: CodeHash
    text: Annotated[str, StringConstraints(strict=True, max_length=MAX_CODE_TEXT)]
    defs: Annotated[tuple[_Name, ...], Field(max_length=1_024)]

    @model_validator(mode="after")
    def _addressed_by_its_text(self) -> RecordCode:
        if code_hash(self.text) != self.hash:
            raise ValueError("The code text does not match its hash.")
        return self


class RecordCell(TransportModel):
    cell_id: CellId
    name: _Name | None
    code: CodeHash | None


class RecordChange(TransportModel):
    cell_id: CellId
    name: _Name | None
    before: CodeHash | None
    after: CodeHash | None


class RecordImage(TransportModel):
    """The annotated PNG, stored as ``images/<sha256>.png``.

    ``outdated``: the selection moved after the image was taken.
    """

    sha256: Sha256
    width: PositiveSafeInteger
    height: PositiveSafeInteger
    captured_at: TimestampText
    outdated: bool


class RecordTrace(TransportModel):
    cells: Annotated[tuple[RecordCell, ...], Field(max_length=MAX_TRACE_CELLS)]
    target: SelectionTarget | None
    anchor: SelectionAnchor | None
    description: TargetInfo | None
    image: RecordImage | None = None


class RecordBaseline(TransportModel):
    """How far the baseline saw the notebook.

    ``repeated`` names the ``before`` codes of this line's changes that more
    than one baseline cell held, so another kernel cannot tell which cell a
    change continues. ``alike`` names the ``before`` codes whose statements
    more than one baseline cell held, so another kernel cannot follow a change
    through reformatted code.
    """

    status: Literal["complete", "incomplete"]
    reason: _Reason | None
    repeated: Annotated[tuple[CodeHash, ...], Field(max_length=MAX_CHANGED_CELLS)] = ()
    alike: Annotated[tuple[CodeHash, ...], Field(max_length=MAX_CHANGED_CELLS)] = ()


class RecordLine(TransportModel):
    """One resolved request, as written to the record."""

    schema_: Literal["marimo-lens.record/1"] = Field(alias="schema")
    id: Identifier
    channel: Channel
    label: SelectionLabel | None
    kernel: Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{16}$")]
    opened_at: TimestampText
    resolved_at: TimestampText
    revision: Revision
    note: NoteText
    summary: AttentionText | None
    trace: RecordTrace
    changes: Annotated[tuple[RecordChange, ...], Field(max_length=MAX_CHANGED_CELLS)]
    codes: Annotated[
        tuple[RecordCode, ...],
        Field(max_length=2 * MAX_CHANGED_CELLS + MAX_TRACE_CELLS),
    ]
    concurrent: Annotated[tuple[Identifier, ...], Field(max_length=256)]
    baseline: RecordBaseline

    def code(self, value: str | None) -> RecordCode | None:
        if value is None:
            return None
        return next((code for code in self.codes if code.hash == value), None)


_LINE_ADAPTER = TypeAdapter(RecordLine)


def code_hashes(snapshot: RuntimeSnapshot, cell_ids: Iterable[str]) -> dict[str, str]:
    """Return the ``code_hash`` of each of ``cell_ids`` that ``snapshot`` read."""

    cells = snapshot.notebook_cells()
    return {
        cell_id: code_hash(cell.code)
        for cell_id in cell_ids
        if (cell := cells.get(cell_id)) is not None
    }


@dataclass(frozen=True, slots=True)
class OpenRequest:
    """Kernel-side facts about one open request.

    ``baseline`` is every cell's code when the request opened or reopened.
    ``concurrent`` names every other request open at the same time, in either
    channel. Only selection requests have an ``owner`` Lens.
    """

    id: str
    channel: Channel
    opened_at: str
    baseline: RuntimeSnapshot
    concurrent: frozenset[str] = frozenset()
    owner: str | None = None
    note: str = ""
    cell_ids: tuple[str, ...] = ()


def build_line(
    request: OpenRequest,
    notebook: RuntimeSnapshot,
    *,
    selection: SelectionRecord | None = None,
    image: bool = False,
    kernel: str,
    resolved_at: str,
    revision: int,
    summary: str | None,
) -> RecordLine:
    """Return the record line for one resolved request.

    Changes compare the request's baseline with the notebook now. A cell that
    exists in only one of them was added or deleted, unless only marimo's
    document showed it and the other side could not read the document. Code
    texts that exceed their bounds stay out of the line, which then reports
    its baseline as incomplete.
    """

    payload = selection.payload if selection is not None else None
    trace_ids = (
        tuple(payload["target"]["cellIds"]) if payload is not None else request.cell_ids
    )
    before = request.baseline
    baseline = before.notebook_cells()
    current = notebook.notebook_cells()
    unregistered = {cell.id for cell in notebook.unregistered}
    gaps = [gap for gap in (_coverage_gap(before), _coverage_gap(notebook)) if gap]
    both_complete = not gaps

    graph_only: list[str] = []

    def observed(cell_id: str) -> bool:
        if cell_id in baseline and cell_id in current:
            return True
        if cell_id in before.unseen or cell_id in notebook.unseen:
            return False
        if not both_complete:
            return False
        if cell_id in current:
            if cell_id in unregistered:
                return before.document
            if not before.document:
                graph_only.append(cell_id)
            return True
        if any(cell.id == cell_id for cell in before.unregistered):
            return notebook.document
        if not notebook.document:
            graph_only.append(cell_id)
        return True

    out_of_reach = [
        cell_id
        for cell_id in sorted(before.unseen | notebook.unseen)
        if not (cell_id in baseline and cell_id in current)
    ]
    if out_of_reach:
        noun = "cell" if len(out_of_reach) == 1 else "cells"
        gaps.append(
            f"Lens could not read the code of {len(out_of_reach)} {noun} "
            "outside a code-mode call"
        )
    changed_ids = [
        cell_id
        for cell_id in dict.fromkeys((*baseline, *current))
        if _code(baseline.get(cell_id)) != _code(current.get(cell_id))
        and observed(cell_id)
    ]
    if graph_only:
        noun = "cell" if len(graph_only) == 1 else "cells"
        gaps.append(
            f"{len(graph_only)} added or deleted {noun} may instead have had code "
            "that did not parse, since one side read only marimo's graph"
        )
    if len(changed_ids) > MAX_CHANGED_CELLS:
        gaps.append(
            f"{len(changed_ids)} cells changed; the line keeps {MAX_CHANGED_CELLS}"
        )
        changed_ids = changed_ids[:MAX_CHANGED_CELLS]

    codes: dict[str, RecordCode] = {}
    oversized = False

    def keep(cell: RuntimeCell | None) -> str | None:
        nonlocal oversized
        if cell is None:
            return None
        address = code_hash(cell.code)
        if address not in codes:
            if len(cell.code) > MAX_CODE_TEXT:
                oversized = True
            else:
                codes[address] = RecordCode(
                    hash=address,
                    text=cell.code,
                    defs=tuple(name for name in cell.defs if len(name) <= 256)[:1_024],
                )
        return address

    changes = [
        RecordChange(
            cell_id=cell_id,
            name=_name(current.get(cell_id) or baseline.get(cell_id)),
            before=keep(baseline.get(cell_id)),
            after=keep(current.get(cell_id)),
        )
        for cell_id in changed_ids
    ]
    held = Counter(code_hash(cell.code) for cell in baseline.values())
    repeated = sorted(
        {
            change.before
            for change in changes
            if change.before and held[change.before] > 1
        }
    )
    shapes = Counter(statement_shape(cell.code) for cell in baseline.values())
    alike = sorted(
        {
            change.before
            for change in changes
            if change.before
            and shapes[statement_shape(baseline[change.cell_id].code)] > 1
        }
    )
    trace_cells = [
        RecordCell(
            cell_id=cell_id,
            name=_name(current.get(cell_id)),
            code=keep(current.get(cell_id)),
        )
        for cell_id in trace_ids[:MAX_TRACE_CELLS]
    ]
    if oversized:
        gaps.append(f"code longer than {MAX_CODE_TEXT:,} characters was left out")

    def line(codes: list[RecordCode], gaps: list[str]) -> RecordLine:
        reason = utf16_text("; ".join(dict.fromkeys(gaps)), 500) or None
        return RecordLine.model_validate(
            {
                "schema": SCHEMA,
                "id": request.id,
                "channel": request.channel,
                "label": payload["label"] if payload is not None else None,
                "kernel": kernel,
                "openedAt": request.opened_at,
                "resolvedAt": resolved_at,
                "revision": revision,
                "note": payload["note"] if payload is not None else request.note,
                "summary": summary,
                "trace": {
                    "cells": trace_cells,
                    "target": payload and payload["target"],
                    "anchor": payload and payload["anchor"],
                    "description": payload and payload["description"],
                    "image": RecordImage.model_validate(
                        selection.image, from_attributes=True
                    )
                    if image and selection is not None and selection.image is not None
                    else None,
                },
                "changes": changes,
                "codes": codes,
                "concurrent": sorted(request.concurrent)[:256],
                "baseline": {
                    "status": "incomplete" if reason else "complete",
                    "reason": reason,
                    "repeated": repeated,
                    "alike": alike,
                },
            },
            strict=False,
        )

    built = line(list(codes.values()), gaps)
    excess = len(serialize_line(built)) - MAX_LINE_BYTES
    if excess <= 0 or not built.codes:
        return built
    note = f"code beyond the {MAX_LINE_BYTES:,}-byte line bound was left out"
    # Leaving a code out removes its JSON and one comma, and the note adds to
    # the reason, so the largest codes go until the line fits.
    excess += len(note.encode()) + 2
    dropped: set[str] = set()
    for code in sorted(built.codes, key=lambda code: len(code.text), reverse=True):
        if excess <= 0:
            break
        dropped.add(code.hash)
        excess -= len(_serialized(code)) + 1
    return line(
        [code for code in built.codes if code.hash not in dropped], [*gaps, note]
    )


def _serialized(code: RecordCode) -> bytes:
    data = code.model_dump(mode="json", by_alias=True)
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8", "surrogatepass"
    )


def serialize_line(line: RecordLine) -> bytes:
    data = line.model_dump(mode="json", by_alias=True)
    return (
        json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        + "\n"
    ).encode("utf-8", "surrogatepass")


@dataclass(frozen=True, slots=True)
class RecordHealth:
    """Where the record keeps resolved requests: the statuses of ``RecordReference``."""

    status: Literal["saved", "unsaved", "session", "failed"]
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.reason:
            object.__setattr__(self, "reason", utf16_text(self.reason, MAX_ERROR))

    def reference(self) -> RecordReference:
        reference = RecordReference(status=self.status)
        if self.reason:
            reference["reason"] = self.reason
        return reference


@dataclass(frozen=True, slots=True)
class RecordRead:
    """One read of the record: its lines, oldest first, and its health.

    ``skipped`` counts stored lines that do not parse. ``truncated`` is true
    when older lines lie beyond the bytes a read covers. ``error`` says why
    the stored lines could not be read at all.
    """

    lines: tuple[RecordLine, ...]
    health: RecordHealth
    skipped: int = 0
    truncated: bool = False
    error: str | None = None


def line_key(line: RecordLine) -> tuple[str, str, str]:
    """Identify one resolution: a reopened request resolves again under its ID."""

    return (line.kernel, line.id, line.resolved_at)


def parse_line(raw: bytes) -> RecordLine | None:
    """Return one valid record line, or None for a fragment or a newer schema."""

    try:
        return _LINE_ADAPTER.validate_json(raw)
    except PydanticValidationError:
        return None


def _coverage_gap(snapshot: RuntimeSnapshot) -> str | None:
    if not snapshot.available:
        return f"Lens could not read the notebook: {snapshot.reason}"
    if snapshot.omitted_cell_count:
        return (
            f"the notebook has {snapshot.omitted_cell_count:,} cells beyond "
            "the 1,000 that Lens reads"
        )
    return None


def _code(cell: RuntimeCell | None) -> str | None:
    return None if cell is None else cell.code


def _name(cell: RuntimeCell | None) -> str | None:
    return None if cell is None or cell.name is None else cell.name[:256]
