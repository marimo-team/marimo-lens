"""Serve Lens on notebook files, with no kernel or browser.

A notebook file is a host with no runtime. ``NotebookFile`` serves the
session's notebook reads and a ``FileJournal`` keeps the record, so the
``LensSession`` that the widget builds labels selections, opens and resolves
requests, and builds context as a Lens on a kernel started from the file
does. Each call starts a new kernel, so the record follows cells from earlier
calls by their code.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from pydantic import TypeAdapter, ValidationError

from ._context.brief import MOUNTED_CALLS
from ._context.lens_context import LensContext
from ._core.bounds import (
    SELECTION_ID_ADAPTER,
    TimestampText,
    parse_timestamp,
    utcnow,
)
from ._core.record import Record
from ._core.types import Diagnostic
from ._marimo.kernel import record_path_for
from ._marimo.notebook_file import NotebookFile
from ._notebook.snapshot import RuntimeSnapshot, cell_label
from ._record.file_journal import FileJournal
from ._schema.model import dump_model
from ._schema.selection import DomHint, PointAnchor, RectAnchor, SelectionInput
from ._selection.images import validate_png
from ._session.runtime import LensRuntime
from ._session.session import LensSession
from ._widget.arguments import optional_text, request_cells, request_note

_DOCUMENT_ID = "document:notebook-file"
_DOM_HINT_KEYS = frozenset(
    field.alias or name for name, field in DomHint.model_fields.items()
)
_MAX_LISTED_CELLS = 24
_TIMESTAMP = TypeAdapter(TimestampText)
# A ``LensContext`` from a notebook file serves context calls, and no mounted
# Lens serves the rest.
_CALLS = replace(MOUNTED_CALLS, text="context.text", mounted=False)

ImageSource = bytes | str | os.PathLike[str]


@dataclass(frozen=True, slots=True)
class Selection:
    """A selection on one cell's output, as an analyst makes it in the browser.

    Pass it to ``notebook_context`` or ``record_request``. Lens labels it and
    keeps its mark, note, DOM hint, and image as the widget does for a
    notebook target, and describes the output by its cell's name, else its ID.

    .. code-block:: python

        marimo_lens.Selection(
            cell="revenue_chart",
            note="Central looks off",
            mark=(0.42, 0.31),
            dom_hint={"tag": "path", "ariaLabel": "region: Central"},
            image="pointed.png",
        )

    Arguments:
        cell: The target cell's name, or its ID as a kernel started on the
            file assigns it.
        note: The analyst's note.
        mark: Where the analyst pointed, in fractions of the output with
            ``(0, 0)`` at its top-left corner: ``(x, y)`` for a point or
            ``(x, y, width, height)`` for a region. ``None`` marks the whole
            output as a region.
        dom_hint: The element under the mark in the DOM hint shape, with
            ``tag`` and optional ``role``, ``ariaLabel``, ``title``,
            ``text``, ``path``, and ``bounds``. Name the pointed data here,
            for example in the ``ariaLabel`` a chart gives the element.
        image: The PNG the analyst saw, as bytes or a file path. Without
            one, the selection image status is ``pending``.
        id: The selection's ID, which the record keeps as the request ID.
            ``notebook_context`` numbers selections without one by position,
            and ``record_request`` gives each a random ID.
    """

    cell: str
    note: str = ""
    mark: tuple[float, float] | tuple[float, float, float, float] | None = None
    dom_hint: Mapping[str, Any] | None = None
    image: ImageSource | None = None
    id: str | None = None


@dataclass(frozen=True, slots=True)
class ChatRequest:
    """A request an analyst made in chat, as ``mounted.open_request()`` opens it.

    Pass it to ``notebook_context`` or ``record_request``.

    .. code-block:: python

        marimo_lens.ChatRequest("Why is Central so low?", cells=("revenue_chart",))

    Arguments:
        note: The analyst's message, quoted.
        cells: The cells the message is about, each by name or ID.
        id: The request's ID, which the record keeps. Lens gives a request
            without one a new ``chat-`` ID.
    """

    note: str
    cells: Sequence[str] = ()
    id: str | None = None


Request = Selection | ChatRequest | Mapping[str, Any]


def notebook_context(
    notebook: str | os.PathLike[str],
    *requests: Request,
    images: Mapping[str, ImageSource] | None = None,
    record: str | os.PathLike[str] | bool = True,
) -> LensContext:
    """Return the Lens context for requests on a notebook file.

    Lens loads the file as a new kernel would, without running it, opens the
    requests in order, and builds the references, text, and history that
    ``Lens.context()`` returns for the same requests, and the same brief
    apart from its calls. The last request is the current one. The brief
    names the calls on the returned context, ``context.text`` among them.

    .. code-block:: python

        context = marimo_lens.notebook_context(
            "sales.py",
            marimo_lens.Selection(cell="revenue_chart", note="Central looks off"),
        )
        print(context.brief)

    The file holds code, cell names, and the dataflow graph. marimo keeps
    the results of the last run in ``__marimo__/session/`` beside the
    notebook. While that run matches the notebook, as ``marimo export
    session`` decides, a cell reads as failed when it raised there and as
    idle otherwise. Without a matching run, each cell that parses reads as
    idle. Control values stay in the kernel, so the text lists no current
    controls.

    Arguments:
        notebook: The marimo notebook file.
        requests: Each a ``Selection``, a ``ChatRequest``, or a selection
            mapping as the widget sends it, with ``id``, ``label``, ``note``,
            ``target``, ``createdAt``, ``anchor``, ``description``,
            ``snapshot``, and optional ``domHint``. Lens keeps a mapping as given,
            apart from the label, which it assigns as a live Lens does.
        images: The PNG of each selection mapping whose ``snapshot`` is
            ``available``, keyed by selection ID, as bytes or a file path.
            The PNG must match the snapshot's ``sha256``, ``width``, and
            ``height``.
        record: ``True`` reads the record a Lens keeps beside the notebook,
            which may not exist yet. A path reads that record file.
            ``False`` builds the context of a Lens that keeps no record.

    Raises:
        ValueError: marimo cannot load the notebook, the record file does not
            exist, a request names a cell the file does not hold, a
            ``Selection`` holds an invalid mark, note, or DOM hint, a
            ``ChatRequest`` has a blank note, a mapping is no valid
            selection, two requests share an ID, or an image is missing,
            unused, or does not match its selection.
        TypeError: A ``ChatRequest`` note is no string, or its cells are no
            sequence of cell names.
        LensError: ``request_limit_reached``: more than 16 chat requests.
        OSError: An image file cannot be read.
    """

    return notebook_session(notebook, *requests, images=images, record=record).context(
        calls=_CALLS
    )


def notebook_session(
    notebook: str | os.PathLike[str],
    *requests: Request,
    images: Mapping[str, ImageSource] | None = None,
    record: str | os.PathLike[str] | bool = True,
) -> LensSession:
    """Open ``requests`` on a notebook file, as ``notebook_context`` describes."""

    path = _path(notebook)
    location = None
    if record is True:
        location = record_path_for(path)
    elif record is not False:
        location = _path(record)
        if not location.is_file():
            raise ValueError(
                f"No record file at {location}. Pass record=True for the "
                "record beside the notebook."
            )
    file = NotebookFile(path)
    session = _session(file, None if location is None else _journal(location))
    created_at = utcnow()
    pending = dict(images or {})
    given = [
        _prepared(
            request, file.contents, pending, created_at=created_at, suffix=str(index)
        )
        for index, request in enumerate(requests, start=1)
    ]
    _require_used(pending)
    ids = [_id(request) for request in given]
    shared = next((item for item in ids if ids.count(item) > 1), None)
    if shared is not None:
        raise ValueError(f"Two requests share the id {shared!r}. Give each its own id.")
    for request in given:
        _open(session, request)
    return session


def record_request(
    before: str | os.PathLike[str],
    after: str | os.PathLike[str],
    request: Selection | ChatRequest,
    *,
    record: str | os.PathLike[str],
    resolved_at: str,
    summary: str | None = None,
    opened_at: str | None = None,
) -> str:
    """Write one resolved request to a notebook's record.

    Lens opens the request on the ``before`` file, as a Lens on a kernel
    started from it would, then reloads the notebook from the ``after`` file
    and resolves the request with ``summary``. marimo matches the cells of
    the two files by their code, as its editor does when a notebook changes
    on disk, so an edited cell stays one cell and an added cell is new. The
    record gains the line a live Lens writes: the note, the selection and its
    label or the chat request's cells, the code of each changed cell before
    and after, and the summary.

    .. code-block:: python

        marimo_lens.record_request(
            "states/r1-before.py",
            "states/r1-after.py",
            marimo_lens.Selection(cell="region_chart", note="Leave the wars out"),
            record="__marimo__/lens/wars.py.jsonl",
            summary="Filtered the cross-regional wars out of the charts.",
            resolved_at="2026-09-02T10:12:00Z",
        )

    Record requests oldest first. ``notebook_context`` and History then
    report whether each change still holds and which request undid it.

    Arguments:
        before: The notebook file when the request opened.
        after: The notebook file when the request resolved.
        request: The ``Selection`` or ``ChatRequest``, naming the cells of
            ``before``.
        record: The record file to append to, such as the
            ``__marimo__/lens/<notebook>.jsonl`` a Lens keeps beside the
            notebook. Lens creates the file and its folder when needed.
        resolved_at: When the request resolved, as an ISO 8601 time with a
            UTC offset, such as ``2026-09-02T10:12:00Z``.
        summary: The resolution summary the analyst sees, at most 240
            characters.
        opened_at: When the request opened. Defaults to ``resolved_at``.

    Returns:
        The request ID, which the record keeps as the line's ``id``.

    Raises:
        ValueError: marimo cannot load a notebook file, a time is invalid or
            ``opened_at`` comes after ``resolved_at``, the record already
            holds the request resolved at ``resolved_at``, or the request is
            invalid as in ``notebook_context``.
        TypeError: The request or ``summary`` has a wrong type.
        OSError: An image file cannot be read, or the record cannot be
            written.
    """

    if not isinstance(request, (Selection, ChatRequest)):
        raise TypeError(
            f"record_request takes a Selection or a ChatRequest. Got {request!r}."
        )
    summary = optional_text(summary, name="summary")
    resolved = _timestamp(resolved_at, "resolved_at")
    opened = resolved if opened_at is None else _timestamp(opened_at, "opened_at")
    if parse_timestamp(opened) > parse_timestamp(resolved):
        raise ValueError(f"opened_at {opened} comes after resolved_at {resolved}.")
    after_path = _path(after)
    location = _path(record)
    # Record lines keep code, so the saved run's cell states go unread.
    file = NotebookFile(_path(before), last_run=False)
    now = opened
    journal = _journal(location)
    session = _session(file, journal, clock=lambda: now)
    given = _prepared(
        request,
        file.contents,
        {},
        created_at=opened,
        suffix=uuid.uuid4().hex[:12],
    )
    request_id = _id(given)
    # A record line is one resolution of a request: its ID and time.
    if any(
        line.id == request_id
        and parse_timestamp(line.resolved_at) == parse_timestamp(resolved)
        for line in journal.read().lines
    ):
        raise ValueError(
            f"{location} already holds request {request_id!r} resolved at "
            f"{resolved}. Record each request once."
        )
    _open(session, given)
    file.reload(after_path)
    now = resolved
    session.resolve(
        (request_id,),
        expected_revision=session.state.revision,
        summary=summary,
    )
    # A live Lens retries an unwritten line on its next call. This session ends here.
    health = journal.read().health
    if health.status == "failed":
        raise OSError(f"Lens could not write the record at {location}: {health.reason}")
    return request_id


def check_notebook(notebook: str | os.PathLike[str]) -> list[Diagnostic]:
    """Run the record rules on a notebook file and the record beside it.

    Raises:
        ValueError: marimo cannot load the file as a notebook.
    """

    path = _path(notebook)
    return _session(
        NotebookFile(path, last_run=False), _journal(record_path_for(path))
    ).check()


def _journal(record: pathlib.Path) -> FileJournal:
    return FileJournal(lambda: record)


def _session(
    file: NotebookFile,
    journal: FileJournal | None,
    *,
    clock: Callable[[], str] | None = None,
) -> LensSession:
    runtime = LensRuntime()
    kept = (
        None
        if journal is None
        else runtime.record(
            # A file host publishes no History, so the session skips it.
            Record(history=False),
            storage="file",
            journal=lambda _storage: journal,
        )
    )
    return LensSession(
        runtime,
        file,
        record=kept,
        owner="notebook-file",
        publish=_ignore,
        publish_history=_ignore,
        clock=clock,
    )


def _ignore(_value: object) -> None:
    pass


def _path(value: str | os.PathLike[str]) -> pathlib.Path:
    # marimo names a notebook by its normalized absolute path.
    return pathlib.Path(os.path.abspath(value))


def _request_id(value: str) -> str:
    try:
        return SELECTION_ID_ADAPTER.validate_python(value)
    except ValidationError:
        raise ValueError(
            f"A request id must be a nonblank string of at most 128 characters. "
            f"Got {value!r}."
        ) from None


def _timestamp(value: str, name: str) -> str:
    try:
        return _TIMESTAMP.validate_python(value)
    except ValidationError:
        raise ValueError(
            f"{name} must be an ISO 8601 time with a UTC offset, such as "
            f"2026-09-02T10:12:00Z. Got {value!r}."
        ) from None


_Prepared = tuple[SelectionInput, bytes | None] | ChatRequest


def _prepared(
    request: Request,
    contents: RuntimeSnapshot,
    images: dict[str, ImageSource],
    *,
    created_at: str,
    suffix: str,
) -> _Prepared:
    """Return the selection the widget would send and its PNG, or the chat request.

    A chat request comes back with its cells as IDs. A request without an ID
    takes ``selection-`` or ``chat-`` and ``suffix``. A mapping takes its PNG
    out of ``images``.
    """

    if isinstance(request, ChatRequest):
        cells = request.cells
        if not isinstance(cells, Sequence) or isinstance(cells, str):
            raise TypeError("ChatRequest cells must be a sequence of cell names.")
        return ChatRequest(
            note=request_note(request.note),
            cells=request_cells([_cell(contents, cell)[0] for cell in cells]),
            id=f"chat-{suffix}" if request.id is None else _request_id(request.id),
        )
    selection = request
    if not isinstance(selection, Selection):
        given = _validated(selection, "A selection mapping")
        cells = contents.notebook_cells()
        for cell_id in given.target.cell_ids:
            if cell_id not in cells:
                raise ValueError(
                    f"Selection {given.id!r} names cell {cell_id!r}, which "
                    f"{pathlib.Path(contents.filename).name} does not hold. "
                    f"Its cells are {_listed(contents)}."
                )
        source = images.pop(given.id, None)
        return given, None if source is None else _read(source)

    selection_id = (
        f"selection-{suffix}" if selection.id is None else _request_id(selection.id)
    )
    cell_id, name = _cell(contents, selection.cell)
    image = None if selection.image is None else _read(selection.image)
    if image is None:
        image_state: dict[str, Any] = {"status": "pending"}
    else:
        width, height = validate_png(image)
        image_state = {
            "status": "available",
            "id": f"image:{selection_id}",
            "mediaType": "image/png",
            "width": width,
            "height": height,
            "sha256": hashlib.sha256(image).hexdigest(),
            "capturedAt": created_at,
        }
    payload: dict[str, Any] = {
        "id": selection_id,
        # A placeholder. The session gives a new selection the next label.
        "label": "S1",
        "note": selection.note,
        "target": {
            "kind": "notebook",
            "cellIds": [cell_id],
            "documentId": _DOCUMENT_ID,
            "documentPath": "/",
        },
        "createdAt": created_at,
        "anchor": _anchor(selection.mark),
        # The widget labels a plain output by its cell's name, else its ID.
        "description": {"label": name or f"Cell {cell_id}"},
        "snapshot": image_state,
    }
    if selection.dom_hint is not None:
        if not isinstance(selection.dom_hint, Mapping):
            raise ValueError(
                f"dom_hint must be a mapping such as {{'tag': 'path'}}. "
                f"Got {selection.dom_hint!r}."
            )
        unknown = set(selection.dom_hint) - _DOM_HINT_KEYS
        if unknown:
            raise ValueError(
                f"dom_hint has no {', '.join(map(repr, sorted(map(str, unknown))))}. "
                f"Its keys are {', '.join(sorted(_DOM_HINT_KEYS))}."
            )
        payload["domHint"] = dict(selection.dom_hint)
    return _validated(payload, f"The selection on {selection.cell!r}"), image


def _require_used(images: Mapping[str, ImageSource]) -> None:
    if images:
        raise ValueError(
            f"images names {', '.join(map(repr, images))}, which no selection "
            "mapping has as its id. Key each image by its selection's id."
        )


def _id(request: _Prepared) -> str:
    if isinstance(request, ChatRequest):
        assert request.id is not None
        return request.id
    return request[0].id


def _open(session: LensSession, request: _Prepared) -> None:
    """Open one request as the widget or ``mounted.open_request()`` does."""

    if isinstance(request, ChatRequest):
        session.open_request(request.note, tuple(request.cells), request_id=request.id)
        return
    selection, image = request
    status = selection.snapshot.status
    if status == "outdated":
        raise ValueError(
            f"Selection {selection.id!r} has an outdated image. Set its snapshot "
            "status to 'available' to give Lens that PNG."
        )
    if status == "available" and image is None:
        raise ValueError(
            f"Selection {selection.id!r} names a captured image. Pass its PNG "
            "in images, or set its snapshot to {'status': 'pending'}."
        )
    if status != "available" and image is not None:
        raise ValueError(
            f"Selection {selection.id!r} has an image, so its snapshot needs "
            "status 'available' with the PNG's sha256, width, and height."
        )
    session.put_selection(
        selection,
        image_action="clear" if image is None else "replace",
        expected_revision=session.state.revision,
        image=image,
    )


def _cell(snapshot: RuntimeSnapshot, cell: str) -> tuple[str, str | None]:
    """Find a cell by ID, then by name."""

    if not isinstance(cell, str):
        raise TypeError(f"Name a cell by its name or ID as a string. Got {cell!r}.")
    cells = snapshot.notebook_cells()
    if cell in cells:
        return cell, cells[cell].name
    named = [found for found in cells.values() if found.name == cell]
    if len(named) == 1:
        return named[0].id, cell
    if named:
        raise ValueError(
            f"{len(named)} cells are named {cell!r}. Name the cell by its ID: "
            f"{_listed(snapshot)}."
        )
    raise ValueError(
        f"{pathlib.Path(snapshot.filename).name} has no cell named {cell!r} or "
        f"with that ID. Its cells are {_listed(snapshot)}."
    )


def _listed(snapshot: RuntimeSnapshot) -> str:
    ordered = [*snapshot.cells, *snapshot.unregistered]
    listed = ", ".join(
        cell_label(item.id, item) for item in ordered[:_MAX_LISTED_CELLS]
    )
    more = len(ordered) - _MAX_LISTED_CELLS
    return f"{listed}, and {more} more" if more > 0 else listed or "none"


def _anchor(mark: tuple[float, ...] | None) -> dict[str, Any]:
    if mark is None:
        return {"kind": "rect", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    if len(mark) not in (2, 4) or not all(
        isinstance(value, (int, float)) and not isinstance(value, bool)
        for value in mark
    ):
        raise ValueError(
            "mark must be (x, y) for a point or (x, y, width, height) for a "
            f"region, in fractions of the output. Got {mark!r}."
        )
    values = [float(value) for value in mark]
    try:
        if len(values) == 2:
            anchor = PointAnchor(kind="point", x=values[0], y=values[1])
        else:
            x, y, width, height = values
            anchor = RectAnchor(kind="rect", x=x, y=y, width=width, height=height)
    except ValidationError:
        raise ValueError(
            f"mark {mark!r} must lie inside the output: each value between 0 "
            "and 1, a region's width and height above 0, and x + width and "
            "y + height at most 1."
        ) from None
    return dump_model(anchor)


def _validated(payload: Mapping[str, Any], name: str) -> SelectionInput:
    try:
        return SelectionInput.model_validate(payload)
    except ValidationError as error:
        detail = error.errors(
            include_url=False, include_context=False, include_input=False
        )[0]
        where = ".".join(str(part) for part in detail["loc"])
        raise ValueError(
            f"{name} is no valid Lens selection: {where or 'value'}: {detail['msg']}."
        ) from None


def _read(source: ImageSource) -> bytes:
    if isinstance(source, bytes):
        return source
    return pathlib.Path(source).read_bytes()
