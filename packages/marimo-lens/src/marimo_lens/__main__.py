"""Read and write Lens records of notebook files: the ``marimo-lens`` command."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections.abc import Mapping, Sequence
from typing import Any

from ._context.brief import BriefCalls
from ._context.lens_context import LensContext
from ._core.errors import LensError
from ._file_context import (
    ChatRequest,
    ImageSource,
    Request,
    Selection,
    check_notebook,
    notebook_session,
    record_request,
)
from ._marimo.kernel import record_path_for

_REQUEST_KEYS = frozenset(
    {"before", "after", "selection", "chat", "summary", "resolved_at", "opened_at"}
)
_SELECTION_KEYS = frozenset({"cell", "note", "mark", "dom_hint", "image", "id"})
_CHAT_KEYS = frozenset({"note", "cells", "id"})


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="marimo-lens")
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser(
        "check",
        help="Check each notebook's Lens record against the notebook file.",
        description=(
            "Run the LR rules on each notebook's Lens record. Exit with 1 when "
            "a warning is found and 2 when a notebook cannot be loaded."
        ),
    )
    check.add_argument("notebooks", nargs="+", type=pathlib.Path)
    check.add_argument("--json", action="store_true", help="Print JSON Lines.")
    _add_context_command(commands)
    record = commands.add_parser(
        "record",
        help="Write past requests to a notebook's Lens record.",
        description=(
            "Append each selection or chat request in REQUESTS, oldest first, to "
            "the record beside "
            "NOTEBOOK, as a Lens that opened it on the request's before file and "
            "resolved it on its after file writes it. Print each request's ID. "
            "Stop with exit 2 at the first request Lens cannot record."
        ),
    )
    record.add_argument("notebook", type=pathlib.Path)
    record.add_argument(
        "requests",
        help=(
            "A JSON file, or - for standard input, holding a list of requests "
            "with before, after, a selection or chat, resolved_at, and optional "
            "summary and opened_at. Paths are relative to the file."
        ),
    )
    arguments = parser.parse_args(argv)
    if arguments.command == "context":
        return _context(parser, arguments)
    if arguments.command == "record":
        return _record(arguments)

    status = 0
    for notebook in arguments.notebooks:
        try:
            diagnostics = check_notebook(notebook)
        except ValueError as error:
            print(f"{notebook}: {error}", file=sys.stderr)
            status = 2
            continue
        for diagnostic in diagnostics:
            if arguments.json:
                print(json.dumps({"file": str(notebook), **diagnostic}))
            else:
                print(
                    f"{notebook}: {diagnostic['code']} {diagnostic['name']} "
                    f"[{diagnostic['severity']}] {diagnostic['message']}"
                )
            if diagnostic["severity"] == "warning" and status == 0:
                status = 1
    return status


def _add_context_command(
    commands: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    context = commands.add_parser(
        "context",
        help="Print the Lens context for a selection on a notebook file.",
        description=(
            "Load the notebook as a new kernel would, without running it, and "
            "print the context a Lens gives an agent for the selection: the "
            "brief, the standalone text, the recorded history of the selected "
            "cells, or all of them as JSON. Exit with 2 when the notebook "
            "cannot be loaded or a selection is invalid."
        ),
    )
    context.add_argument("notebook", type=pathlib.Path)
    selection = context.add_argument_group(
        "selection", "Describe the selection the analyst made on a cell's output."
    )
    selection.add_argument("--cell", help="The selected cell's name or ID.")
    selection.add_argument("--note", default="", help="The analyst's note.")
    selection.add_argument(
        "--mark",
        type=_mark,
        help=(
            "X,Y for a point or X,Y,WIDTH,HEIGHT for a region, in fractions of "
            "the output. Omit it to mark the whole output."
        ),
    )
    selection.add_argument(
        "--dom-hint",
        type=_json_object,
        metavar="JSON",
        help='The element under the mark, such as \'{"tag": "rect", "ariaLabel": "Central"}\'.',
    )
    selection.add_argument(
        "--image",
        type=pathlib.Path,
        metavar="PNG",
        help=(
            "The PNG the analyst saw. It belongs to the --cell selection, or "
            "else to the last --selection."
        ),
    )
    selection.add_argument(
        "--selection",
        action="append",
        default=[],
        metavar="FILE",
        help=(
            "A JSON file, or - for standard input, holding a selection as the "
            "widget sends it, or a list of them. Repeat it for more. The "
            "--cell selection comes last and is the current one."
        ),
    )
    record = context.add_mutually_exclusive_group()
    record.add_argument(
        "--record",
        type=pathlib.Path,
        metavar="PATH",
        help="Read this record file instead of the one beside the notebook.",
    )
    record.add_argument(
        "--no-record",
        action="store_true",
        help="Build the context of a Lens that keeps no record.",
    )
    context.add_argument(
        "--format",
        choices=("brief", "text", "history", "json"),
        default="brief",
        help=(
            "brief (the default), text, history as JSON Lines, or json with "
            "the request, references, brief, text, and history."
        ),
    )


def _context(parser: argparse.ArgumentParser, arguments: argparse.Namespace) -> int:
    if arguments.cell is None and not arguments.selection:
        parser.error("name the selection with --cell or --selection.")
    if arguments.cell is None and (
        arguments.note or arguments.mark or arguments.dom_hint is not None
    ):
        parser.error("--note, --mark, and --dom-hint describe the --cell selection.")
    if arguments.selection.count("-") > 1:
        parser.error("standard input can hold one --selection.")
    if arguments.no_record and arguments.format == "history":
        parser.error("--format history reads the record, so drop --no-record.")

    notebook: pathlib.Path = arguments.notebook
    try:
        mappings = [item for source in arguments.selection for item in _items(source)]
        if not mappings and arguments.cell is None:
            raise ValueError("The --selection files hold no selection.")
        images: dict[str, ImageSource] = {}
        if arguments.cell is None and arguments.image is not None:
            image_id = mappings[-1].get("id")
            if not isinstance(image_id, str):
                raise ValueError("The last --selection has no id to give --image to.")
            images[image_id] = arguments.image
        given: list[Request] = [*mappings]
        if arguments.cell is not None:
            given.append(
                Selection(
                    cell=arguments.cell,
                    note=arguments.note,
                    mark=arguments.mark,
                    dom_hint=arguments.dom_hint,
                    image=arguments.image,
                )
            )
        session = notebook_session(
            notebook,
            *given,
            images=images,
            record=(
                False
                if arguments.no_record
                else (arguments.record if arguments.record is not None else True)
            ),
        )
        context = session.context(calls=_calls(arguments.image))
        output = _render(context, arguments.format, recorded=not arguments.no_record)
    except (ValueError, OSError, LensError) as error:
        print(f"{notebook}: {error}", file=sys.stderr)
        return 2
    if output:
        print(output)
    return 0


def _calls(image: pathlib.Path | None) -> BriefCalls:
    """Name this command's formats as the calls that fetch more."""

    shown = None if image is None else f"`{image.absolute()}`"
    return BriefCalls(
        history="`--format history` output",
        request_history="`--format history` output",
        references="`--format json` output",
        # Lens holds the PNG of the current request only from --image.
        image=lambda _selection_id: str(shown),
        text="`--format text` output",
        mounted=False,
    )


def _render(context: LensContext, form: str, *, recorded: bool) -> str:
    if form == "brief":
        return context.brief
    if form == "text":
        return context.text
    if form == "history":
        return "\n".join(json.dumps(row) for row in _history(context))
    return json.dumps(
        {
            "request": context.request,
            "references": context.references,
            "brief": context.brief,
            "text": context.text,
            "history": _history(context) if recorded else None,
        },
        indent=2,
        ensure_ascii=False,
    )


def _history(context: LensContext) -> list[Any]:
    """The recorded requests on the request's cells and upstream, as the brief lists them."""

    request = context.request
    if request is not None and request["cells"]:
        return list(context.history(request))
    return list(context.history())


def _record(arguments: argparse.Namespace) -> int:
    source: str = arguments.requests
    folder = (
        pathlib.Path.cwd() if source == "-" else pathlib.Path(source).absolute().parent
    )
    if not arguments.notebook.is_file():
        print(f"{arguments.notebook}: no notebook file.", file=sys.stderr)
        return 2
    try:
        requests = _items(source)
    except (ValueError, OSError) as error:
        print(f"{source}: {error}", file=sys.stderr)
        return 2
    record = record_path_for(arguments.notebook.absolute())
    for index, request in enumerate(requests, start=1):
        try:
            print(_record_one(request, folder, record))
        except (ValueError, TypeError, OSError, LensError) as error:
            print(f"{source}: request {index}: {error}", file=sys.stderr)
            return 2
    return 0


def _record_one(
    request: Mapping[str, Any], folder: pathlib.Path, record: pathlib.Path
) -> str:
    def path(value: object, key: str) -> pathlib.Path:
        if not isinstance(value, str):
            raise TypeError(f"{key} must be a path string.")
        return folder / value

    selection = request.get("selection")
    chat = request.get("chat")
    unknown = (
        (set(request) - _REQUEST_KEYS)
        | (set(selection if isinstance(selection, dict) else ()) - _SELECTION_KEYS)
        | (set(chat if isinstance(chat, dict) else ()) - _CHAT_KEYS)
    )
    if unknown:
        raise ValueError(f"unknown keys {', '.join(sorted(unknown))}.")
    given: Request
    if isinstance(chat, dict) and selection is None:
        cells = chat.get("cells", [])
        if not isinstance(cells, list):
            raise TypeError("chat cells must be a list of cell names.")
        given = ChatRequest(
            note=chat.get("note", ""), cells=tuple(cells), id=chat.get("id")
        )
    elif isinstance(selection, dict) and "cell" in selection and chat is None:
        mark = selection.get("mark")
        if mark is not None and not isinstance(mark, list):
            raise TypeError("mark must be a list of numbers.")
        image = selection.get("image")
        given = Selection(
            cell=selection["cell"],
            note=selection.get("note", ""),
            mark=None if mark is None else tuple(mark),
            dom_hint=selection.get("dom_hint"),
            image=None if image is None else path(image, "selection.image"),
            id=selection.get("id"),
        )
    else:
        raise ValueError("give either a selection with a cell or a chat with a note.")
    return record_request(
        path(request.get("before"), "before"),
        path(request.get("after"), "after"),
        given,
        resolved_at=request.get("resolved_at", ""),
        summary=request.get("summary"),
        opened_at=request.get("opened_at"),
        record=record,
    )


def _items(source: str) -> list[dict[str, Any]]:
    """Read a JSON object or a list of objects from a file or standard input."""

    text = sys.stdin.read() if source == "-" else pathlib.Path(source).read_text()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"{source} holds no JSON: {error}.") from None
    items = value if isinstance(value, list) else [value]
    if not all(isinstance(item, dict) for item in items):
        raise ValueError(f"{source} must hold a JSON object or a list of them.")
    return items


def _mark(value: str) -> tuple[float, ...]:
    try:
        return tuple(float(part) for part in value.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(
            "use X,Y for a point or X,Y,WIDTH,HEIGHT for a region, such as 0.4,0.3"
        ) from None


def _json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise argparse.ArgumentTypeError(f"not JSON: {error}") from None
    if not isinstance(parsed, dict):
        raise argparse.ArgumentTypeError("must be a JSON object")
    return parsed


if __name__ == "__main__":
    sys.exit(main())
