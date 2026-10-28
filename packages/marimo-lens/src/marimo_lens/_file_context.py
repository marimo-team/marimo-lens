"""Serve Lens on notebook files, with no kernel or browser.

A notebook file is a host with no runtime. ``NotebookFile`` serves the
session's notebook reads and a ``FileJournal`` keeps the record, so the
``LensSession`` that the widget builds labels selections and builds context
as a Lens on a kernel started from the file does. Each call starts a new kernel, so the record follows cells from earlier
calls by their code.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from ._context.lens_context import LensContext
from ._core.bounds import utcnow
from ._core.record import Record
from ._core.types import Diagnostic
from ._marimo.kernel import record_path_for
from ._marimo.notebook_file import NotebookFile
from ._notebook.snapshot import RuntimeSnapshot, cell_label
from ._record.file_journal import FileJournal
from ._schema.model import dump_model
from ._schema.selection import PointAnchor, RectAnchor, SelectionInput
from ._selection.images import validate_png
from ._session.runtime import LensRuntime
from ._session.session import LensSession

_DOCUMENT_ID = "document:notebook-file"
_MAX_LISTED_CELLS = 24

ImageSource = bytes | str | os.PathLike[str]


@dataclass(frozen=True, slots=True)
class Selection:
    """A selection on one cell's output, as an analyst makes it in the browser.

    Pass it to ``notebook_context``. Lens labels it and keeps its anchor, note, DOM hint, and image as the widget does for a
    notebook target.

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
            ``text``, ``path``, and ``bounds``. Name the datum here, for
            example the ``aria-label`` a chart gives the mark.
        image: The PNG the analyst saw, as bytes or a file path. Without
            one, the selection image status is ``pending``.
        id: The selection's ID, which the record keeps as the request ID.
            ``notebook_context`` numbers selections without one by position.
    """

    cell: str
    note: str = ""
    mark: tuple[float, float] | tuple[float, float, float, float] | None = None
    dom_hint: Mapping[str, Any] | None = None
    image: ImageSource | None = None
    id: str | None = None


def notebook_context(
    notebook: str | os.PathLike[str],
    *selections: Selection | Mapping[str, Any],
    images: Mapping[str, ImageSource] | None = None,
    record: str | os.PathLike[str] | bool = True,
) -> LensContext:
    """Return the Lens context for selections on a notebook file.

    Lens loads the file as a new kernel would, without running it, and builds
    the brief, references, text, and history that ``Lens.context()`` returns
    for the same selections. The last selection is the current one. The
    brief leaves out the calls on a mounted Lens.

    .. code-block:: python

        context = marimo_lens.notebook_context(
            "sales.py",
            marimo_lens.Selection(cell="revenue_chart", note="Central looks off"),
        )
        print(context.brief)

    The file holds code, cell names, and the dataflow graph. It holds no run
    results or control values, so each cell that parses reads as idle and the
    text lists no current controls.

    Arguments:
        notebook: The marimo notebook file.
        selections: Each a ``Selection``, or a selection mapping as the
            widget sends it, with ``id``, ``label``, ``note``, ``target``,
            ``createdAt``, ``anchor``, optional ``domHint``, ``description``,
            and ``snapshot``. Lens keeps a mapping as given, apart from the
            label, which it assigns as a live Lens does.
        images: The PNG of each selection mapping whose ``snapshot`` is
            ``available``, keyed by selection ID, as bytes or a file path.
            The PNG must match the snapshot's ``sha256``, ``width``, and
            ``height``.
        record: ``True`` reads the record a Lens keeps beside the notebook,
            which may not exist yet. A path reads that record file.
            ``False`` builds the context of a Lens that keeps no record.

    Raises:
        ValueError: marimo cannot load the notebook, the record file does not
            exist, a ``Selection`` names no cell or holds an invalid mark,
            note, or DOM hint, a mapping is no valid selection, or an image
            is missing, unused, or does not match its selection.
        OSError: An image file cannot be read.
    """

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
    session = _session(file, location)
    created_at = utcnow()
    pending = dict(images or {})
    given = [
        _input(
            selection,
            file.contents,
            pending,
            created_at=created_at,
            default_id=f"selection-{index}",
        )
        for index, selection in enumerate(selections, start=1)
    ]
    _require_used(pending)
    for selection, image in given:
        _put(session, selection, image)
    return session.context(mounted=False)


def check_notebook(notebook: str | os.PathLike[str]) -> list[Diagnostic]:
    """Run the record rules on a notebook file and the record beside it.

    Raises:
        ValueError: marimo cannot load the file as a notebook.
    """

    path = _path(notebook)
    return _session(NotebookFile(path), record_path_for(path)).check()


def _session(
    file: NotebookFile,
    record: pathlib.Path | None,
) -> LensSession:
    runtime = LensRuntime()
    kept = (
        None
        if record is None
        else runtime.record(
            # A file host publishes no History, so the session skips it.
            Record(history=False),
            storage="file",
            journal=lambda _storage: FileJournal(lambda: record),
        )
    )
    return LensSession(
        runtime,
        file,
        record=kept,
        owner="notebook-file",
        publish=_ignore,
        publish_history=_ignore,
    )


def _ignore(_value: object) -> None:
    pass


def _path(value: str | os.PathLike[str]) -> pathlib.Path:
    # marimo names a notebook by its normalized absolute path.
    return pathlib.Path(os.path.abspath(value))


def _input(
    selection: Selection | Mapping[str, Any],
    contents: RuntimeSnapshot,
    images: dict[str, ImageSource],
    *,
    created_at: str,
    default_id: str,
) -> tuple[SelectionInput, bytes | None]:
    """Return the selection the widget would send and its PNG.

    A mapping takes its PNG out of ``images``.
    """

    if not isinstance(selection, Selection):
        given = _validated(selection, "A selection mapping")
        source = images.pop(given.id, None)
        return given, None if source is None else _read(source)

    selection_id = selection.id or default_id
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
        payload["domHint"] = dict(selection.dom_hint)
    return _validated(payload, f"The selection on {selection.cell!r}"), image


def _require_used(images: Mapping[str, ImageSource]) -> None:
    if images:
        raise ValueError(
            f"images names {', '.join(map(repr, images))}, which no selection "
            "mapping has as its id. Key each image by its selection's id."
        )


def _put(session: LensSession, selection: SelectionInput, image: bytes | None) -> None:
    """Admit one selection the way the widget sends it with its capture."""

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
    if session.state.record(selection.id) is not None:
        raise ValueError(
            f"Two selections share the id {selection.id!r}. Give each its own id."
        )
    session.put_selection(
        selection,
        image_action="clear" if image is None else "replace",
        expected_revision=session.state.revision,
        image=image,
    )


def _cell(snapshot: RuntimeSnapshot, cell: str) -> tuple[str, str | None]:
    """Find a cell by ID, then by name."""

    cells = snapshot.notebook_cells()
    if cell in cells:
        return cell, cells[cell].name
    named = [found for found in cells.values() if found.name == cell]
    if len(named) == 1:
        return named[0].id, cell
    ordered = [*snapshot.cells, *snapshot.unregistered]
    listed = ", ".join(
        cell_label(item.id, item) for item in ordered[:_MAX_LISTED_CELLS]
    )
    more = len(ordered) - _MAX_LISTED_CELLS
    if more > 0:
        listed += f", and {more} more"
    if named:
        raise ValueError(
            f"{len(named)} cells are named {cell!r}. Name the cell by its ID: {listed}."
        )
    raise ValueError(
        f"{pathlib.Path(snapshot.filename).name} has no cell named {cell!r} or "
        f"with that ID. Its cells are {listed or 'none'}."
    )


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
