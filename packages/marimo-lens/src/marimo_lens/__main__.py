"""Read Lens context and records of notebook files: the ``marimo-lens`` command."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections.abc import Sequence
from typing import Any

from ._context.brief import BriefCalls
from ._context.lens_context import LensContext
from ._core.errors import LensError
from ._file_context import Selection, check_notebook, notebook_session


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
    arguments = parser.parse_args(argv)
    if arguments.command == "context":
        return _context(parser, arguments)

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
    selection.add_argument(
        "--cell", required=True, help="The selected cell's name or ID."
    )
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
        "--image", type=pathlib.Path, metavar="PNG", help="The PNG the analyst saw."
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
    if arguments.no_record and arguments.format == "history":
        parser.error("--format history reads the record, so drop --no-record.")

    notebook: pathlib.Path = arguments.notebook
    try:
        session = notebook_session(
            notebook,
            Selection(
                cell=arguments.cell,
                note=arguments.note,
                mark=arguments.mark,
                dom_hint=arguments.dom_hint,
                image=arguments.image,
            ),
            record=(
                False
                if arguments.no_record
                else (arguments.record if arguments.record is not None else True)
            ),
        )
        context = session.context(
            calls=BriefCalls(
                history="`--format history` output",
                request_history="`--format history` output",
                references="`--format json` output",
                # The brief names an image only when --image gave one.
                image=lambda _selection_id: f"`{arguments.image.absolute()}`",
                text="`--format text` output",
                mounted=False,
            )
        )
        output = _render(context, arguments.format, recorded=not arguments.no_record)
    except (ValueError, OSError, LensError) as error:
        print(f"{notebook}: {error}", file=sys.stderr)
        return 2
    if output:
        print(output)
    return 0


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
    """The recorded requests on the selected cells and upstream, as the brief lists them."""

    return list(context.history(context.request))


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
