"""Check notebook files against their Lens records: ``python -m marimo_lens check``."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections.abc import Sequence

from ._checks import check_record
from ._core.types import Diagnostic
from ._marimo.kernel import record_path_for
from ._marimo.notebook_file import notebook_file_snapshot
from ._record.file_journal import FileJournal
from ._record.journal import has_image
from ._record.status import RecordStatus


def check_notebook(notebook: pathlib.Path) -> list[Diagnostic]:
    """Run the record rules on one notebook file and its record.

    Raises:
        ValueError: marimo cannot load the file as a notebook.
    """

    snapshot = notebook_file_snapshot(notebook)
    record = record_path_for(notebook)
    journal = FileJournal(lambda: record)
    read = journal.read()
    status = RecordStatus(read.lines, snapshot, kernel=None)
    return check_record(
        read,
        status,
        has_image=lambda sha256: has_image(journal, sha256),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m marimo_lens")
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
    arguments = parser.parse_args(argv)

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


if __name__ == "__main__":
    sys.exit(main())
