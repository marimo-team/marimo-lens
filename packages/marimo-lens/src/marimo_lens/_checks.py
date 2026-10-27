"""Check open selections and the notebook's record against the notebook now.

marimo already reports cells that define the same name. These rules test what
only Lens knows: whether a selected output still reflects its code (``LV``),
whether a target's published sources name real definitions (``LT``), and
whether the record still lines up with the notebook's cells (``LR``).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, Literal

from ._core.types import Diagnostic, RecordedChange
from ._notebook.snapshot import RuntimeCell, RuntimeSnapshot, cell_label, cell_state
from ._record.lines import RecordLine, RecordRead
from ._record.status import UNRECORDED, UNRECORDED_EDIT, RecordStatus

_LEADING_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def check_selections(
    selections: Sequence[Mapping[str, Any]],
    baselines: Mapping[str, RuntimeSnapshot],
    snapshot: RuntimeSnapshot,
) -> list[Diagnostic]:
    """Run the ``LV`` and ``LT`` rules on open selections."""

    cells = snapshot.notebook_cells()
    diagnostics: list[Diagnostic] = []
    for selection in selections:
        label = str(selection["label"])
        selection_id = str(selection["id"])
        baseline = baselines.get(selection_id)
        for cell_id in selection["target"]["cellIds"]:
            cell = cells.get(cell_id)
            if cell is None:
                continue
            where = _cell(cell)
            state = cell_state(cell)
            if state == "stale":
                diagnostics.append(
                    _diagnostic(
                        "LV001",
                        "stale-output",
                        "warning",
                        f"{label} shows the output of {where}, which is stale: "
                        "its code or inputs changed since it last ran.",
                        cell_id,
                        selection_id,
                    )
                )
            elif state == "failed":
                diagnostics.append(
                    _diagnostic(
                        "LV002",
                        "failed-output",
                        "warning",
                        f"{label} shows the output of {where}, whose last run failed.",
                        cell_id,
                        selection_id,
                    )
                )
            earlier = baseline.notebook_cells().get(cell_id) if baseline else None
            if earlier is not None and earlier.code != cell.code:
                diagnostics.append(
                    _diagnostic(
                        "LV003",
                        "changed-since-selected",
                        "info",
                        f"{label} was selected before {where} changed, so its "
                        "note and image describe the earlier output.",
                        cell_id,
                        selection_id,
                    )
                )
        for source in selection["target"].get("sources", ()):
            diagnostics.extend(
                _check_source(source, label, selection_id, cells, snapshot)
            )
    return diagnostics


def check_record(
    read: RecordRead,
    status: RecordStatus,
    *,
    has_image: Callable[[str], bool],
) -> list[Diagnostic]:
    """Run the ``LR`` rules on the record."""

    diagnostics: list[Diagnostic] = []
    if read.error is not None:
        diagnostics.append(
            _diagnostic(
                "LR005",
                "unreadable-record",
                "warning",
                f"{read.error}, so its requests went unchecked.",
                None,
                None,
            )
        )
    if read.truncated:
        diagnostics.append(
            _diagnostic(
                "LR006",
                "partial-record",
                "info",
                "The record is larger than Lens reads at once, so its oldest "
                "requests went unchecked.",
                None,
                None,
            )
        )
    if read.skipped:
        lines = "line" if read.skipped == 1 else "lines"
        diagnostics.append(
            _diagnostic(
                "LR001",
                "unreadable-record-line",
                "warning",
                f"The record holds {read.skipped} {lines} Lens cannot read: a "
                "fragment of an interrupted write, an edit, or a newer schema.",
                None,
                None,
            )
        )
    requests = status.requests()
    titles = {line.id: line.label or line.id for line, _row in requests}
    for line, row in requests:
        title = line.label or line.id
        for change, recorded in zip(line.changes, row["changes"], strict=True):
            # A change whose cell is gone is LR003's.
            cell_id = recorded["cellId"]
            if recorded["status"] == "undone" and cell_id is not None:
                cell = cell_label(cell_id, status.cells.get(cell_id), recorded["name"])
                diagnostics.append(_undone(title, line.id, cell, recorded, titles))
            hashes = (change.before, change.after)
            if any(value is not None and line.code(value) is None for value in hashes):
                diagnostics.append(
                    _diagnostic(
                        "LR002",
                        "missing-code",
                        "info",
                        f"The record kept no code for a change {title} made, so "
                        "whether it still holds is unknown.",
                        recorded["cellId"],
                        line.id,
                    )
                )
            elif (
                change.after is not None
                and recorded["cellId"] is None
                and recorded["status"] != "unknown"
            ):
                diagnostics.append(_lost(title, line.id, change.cell_id, "changed"))
        recorded = line.trace.image
        if recorded is not None and not has_image(recorded.sha256):
            diagnostics.append(
                _diagnostic(
                    "LR004",
                    "missing-image",
                    "info",
                    f"The record no longer holds the image {title} showed "
                    f"(images/{recorded.sha256}.png).",
                    None,
                    line.id,
                )
            )
        for cell_id in status.gone(line):
            if not _deleted(line, cell_id):
                diagnostics.append(_lost(title, line.id, cell_id, "pointed at"))
    return diagnostics


def _undone(
    title: str,
    request_id: str,
    cell: str,
    change: RecordedChange,
    titles: Mapping[str, str],
) -> Diagnostic:
    """A recorded change that the notebook no longer holds in ``cell``."""

    by = change["undoneBy"]
    if by == UNRECORDED:
        since = f" since {UNRECORDED_EDIT}"
    elif by is not None:
        since = f" since {titles.get(by, by)}"
    else:
        since = ""
    return _diagnostic(
        "LR007",
        "undone-change",
        "info",
        f"The change {title} made to {cell} no longer holds{since}. "
        "context.history() lists the statements it lost.",
        change["cellId"],
        request_id,
    )


def _check_source(
    source: Mapping[str, Any],
    label: str,
    selection_id: str,
    cells: Mapping[str, RuntimeCell],
    snapshot: RuntimeSnapshot,
) -> Iterable[Diagnostic]:
    cell_id = str(source["cellId"])
    cell = cells.get(cell_id)
    if cell is None:
        if (
            snapshot.available
            and not snapshot.omitted_cell_count
            and cell_id not in snapshot.unseen
        ):
            yield _diagnostic(
                "LT001",
                "missing-source-cell",
                "warning",
                f"{label} names source cell `{cell_id}`, which is not in the notebook.",
                None,
                selection_id,
            )
        return
    # A cell only marimo's document shows does not parse, so its names are unknown.
    registered = any(item.id == cell_id for item in snapshot.cells)
    selector = source.get("selector")
    match = _LEADING_NAME.match(selector or "")
    if (
        registered
        and cell.language == "python"
        and match
        and match.group() not in cell.defs
    ):
        yield _diagnostic(
            "LT002",
            "undefined-source",
            "warning",
            f"{label} names the value {selector!r} in {_cell(cell)}, which "
            f"defines no {match.group()}.",
            cell_id,
            selection_id,
        )


def _deleted(line: RecordLine, cell_id: str) -> bool:
    return any(
        change.cell_id == cell_id and change.after is None for change in line.changes
    )


def _lost(title: str, request_id: str, cell_id: str, verb: str) -> Diagnostic:
    return _diagnostic(
        "LR003",
        "lost-cell",
        "info",
        f"{title} {verb} cell `{cell_id}`, which is no longer in the notebook.",
        None,
        request_id,
    )


def _cell(cell: RuntimeCell) -> str:
    return f"cell `{cell.id}`" + (f" ({cell.name})" if cell.name else "")


def _diagnostic(
    code: str,
    name: str,
    severity: Literal["warning", "info"],
    message: str,
    cell_id: str | None,
    request_id: str | None,
) -> Diagnostic:
    return Diagnostic(
        code=code,
        name=name,
        severity=severity,
        message=message,
        cellId=cell_id,
        requestId=request_id,
    )
