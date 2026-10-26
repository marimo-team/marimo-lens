"""Typed dictionaries and handles that the public Lens API returns."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, NewType, TypeAlias, TypedDict

from typing_extensions import NotRequired


class RecordReference(TypedDict):
    """Whether the notebook's record file holds every resolved request.

    ``saved`` means it does. ``unsaved`` means the notebook has no file name,
    so Lens keeps resolved requests in memory and writes them once it has one.
    ``session`` means the notebook runtime keeps them in memory until it
    restarts, as in a marimo app or marimo's Pyodide runtime. ``failed`` means
    Lens could not write, move, or read the record. Lens writes waiting lines
    again at the next resolution and at every record read, such as
    ``context()``, ``check()``, or a History refresh. ``reason`` explains the
    last three.
    """

    status: Literal["saved", "unsaved", "session", "failed"]
    reason: NotRequired[str]


class NotebookReference(TypedDict):
    """Bounded notebook metadata captured by one :class:`LensContext`.

    ``record`` is the health of the record the Lens keeps, or None when the
    Lens was built without ``record=Record()``.
    """

    path: str
    available: bool
    record: RecordReference | None
    reason: NotRequired[str]


CellStatus: TypeAlias = Literal["available", "missing", "unavailable"]


class CellReference(TypedDict):
    """One notebook cell a request points at.

    ``status`` is ``available`` while the notebook has the cell, ``missing``
    once it does not, and ``unavailable`` when Lens cannot read the runtime.
    ``codeHash`` is the cell's ``code_hash`` in marimo's host protocol for the
    code the cell held when the request opened: the first 16 hex characters
    of SHA-256 over that code. A host client, such as marimo pair's
    ``view_notebook``, reads the cell's current ``code_hash``. A different
    value means the cell changed after the analyst pointed at it. ``codeHash``
    is None when Lens read no code for the cell then.
    """

    id: str
    status: CellStatus
    codeHash: str | None


def cell_address(value: object) -> object:
    """Return the cell ID a cell reference names, or ``value`` itself.

    Lens takes the cell references it returns wherever it takes a cell ID.
    Callers validate the ID.
    """

    if isinstance(value, Mapping) and "id" in value:
        return value["id"]
    return value


class _NotebookTargetReference(TypedDict):
    kind: Literal["notebook"]
    cellIds: list[str]
    documentId: str
    documentPath: str


class NotebookSourceReference(TypedDict):
    """A resolved notebook cell and optional symbolic value selector."""

    cellId: str
    selector: str | None


class _DomTargetReference(TypedDict):
    kind: Literal["dom"]
    cellIds: list[str]
    sources: list[NotebookSourceReference]
    documentId: str
    documentPath: str
    domSelector: str


SelectionTargetReference: TypeAlias = _NotebookTargetReference | _DomTargetReference


class RenderSourceReference(TypedDict):
    """Client-supplied rendering location, separate from notebook provenance."""

    path: str
    line: NotRequired[int]
    column: NotRequired[int]
    symbol: NotRequired[str]


class TargetMediaReference(TypedDict):
    """The file a target shows part of, with its page or time span in seconds."""

    path: str
    page: NotRequired[int]
    start: NotRequired[float]
    end: NotRequired[float]


class TargetDescription(TypedDict):
    """Bounded presentation captured when the selection was created."""

    label: str
    detail: NotRequired[str]
    renderSource: NotRequired[RenderSourceReference]
    media: NotRequired[TargetMediaReference]


class SelectionReference(TypedDict):
    """One JSON-safe reference to an open Lens selection."""

    id: str
    label: str
    note: str
    target: SelectionTargetReference
    cells: list[CellReference]
    anchor: Mapping[str, object]
    snapshot: Mapping[str, object]
    description: NotRequired[TargetDescription]
    domHint: NotRequired[Mapping[str, object]]
    previousResolution: NotRequired[Mapping[str, object]]


class ChatRequestReference(TypedDict):
    """One open chat request: the analyst's message as the agent quoted it."""

    id: str
    note: str
    cells: list[CellReference]
    openedAt: str


class RequestReference(TypedDict):
    """The open request described by a context's brief.

    ``cells`` are a selection's producing cells or the cells the agent named
    for a chat request, each as its selection or chat reference lists it.
    """

    id: str
    channel: Literal["selection", "chat"]
    label: str | None
    note: str
    cells: list[CellReference]


class LensReferences(TypedDict):
    """JSON-safe references captured by one :class:`LensContext`."""

    revision: int
    generatedAt: str
    notebook: NotebookReference
    currentSelectionId: str | None
    selections: list[SelectionReference]
    chatRequests: list[ChatRequestReference]


class RecordedChange(TypedDict):
    """One cell a recorded request changed, and whether the change still holds.

    ``cellId`` is the current cell that continues the changed cell, or None
    when it no longer exists or Lens cannot locate it. ``status`` is ``in_force`` while the statements
    the request added still hold in that cell, or, for a request that only
    removed statements, while they stay gone. It is ``undone`` otherwise, and
    ``unknown`` when the record did not keep the code or the snapshot cannot
    show the cell. An undone change
    names the request that undid it in ``undoneBy``, ``"unrecorded"`` for an
    edit no recorded request made, or None when the record left out code
    from the undone period.
    ``missing`` lists added statements that are gone, ``restored`` lists
    removed statements that are back, and ``movedTo`` lists other cells that
    now hold lost statements or define names the cell no longer defines.
    """

    cellId: str | None
    name: str | None
    status: Literal["in_force", "undone", "unknown"]
    undoneBy: str | None
    movedTo: list[str]
    missing: list[str]
    restored: list[str]


class RecordedImage(TypedDict):
    """The annotated PNG the analyst saw when a selection request resolved.

    ``outdated`` is true when the selection moved after the image was taken,
    so its marker shows an earlier point or region. ``path`` is the PNG file
    in the notebook's ``__marimo__/lens/images/`` folder, or None when the
    record keeps no readable file, as for a notebook without a file name or in
    marimo's Pyodide runtime.
    """

    sha256: str
    width: int
    height: int
    capturedAt: str
    outdated: bool
    path: str | None


class RecordedRequest(TypedDict):
    """One resolved request from the notebook's record.

    ``note`` is the analyst's note for a selection request and the analyst's
    message as the agent quoted it for a chat request. ``summary`` is what the
    agent reported when it resolved the request. ``cellIds`` are the current
    cells the request pointed at: a selection's producing cells, or the cells
    the agent named for a chat request. ``image`` is the selection's annotated
    PNG, or None for a chat request or a selection without a captured image.
    """

    id: str
    channel: Literal["selection", "chat"]
    label: str | None
    note: str
    summary: str | None
    openedAt: str
    resolvedAt: str
    cellIds: list[str]
    changes: list[RecordedChange]
    concurrent: list[str]
    image: RecordedImage | None


ActivityHandle = NewType("ActivityHandle", str)


class RevealStep(TypedDict):
    """A cell or selection and the explanation shown while visiting it."""

    target: str | SelectionReference
    label: NotRequired[str]
    message: NotRequired[str]


class Diagnostic(TypedDict):
    """One finding from ``Lens.check()``, shaped like a marimo lint diagnostic.

    ``code`` and ``name`` identify the rule, such as ``LV001`` and
    ``stale-output``. ``severity`` is ``warning`` when the evidence an agent
    or analyst relies on is wrong, and ``info`` when it is only older or
    incomplete. ``cellId`` names the current cell the finding is about, and
    ``requestId`` the selection or recorded request, when there is one.
    """

    code: str
    name: str
    severity: Literal["warning", "info"]
    message: str
    cellId: str | None
    requestId: str | None
