from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

from marimo_lens.context import LensContext

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_primary_skill_routes_agents_into_code_mode_through_pair() -> None:
    skill = (REPOSITORY_ROOT / "skills/marimo-lens/SKILL.md").read_text()

    assert (
        "npx skills add https://github.com/marimo-team/marimo-pair --skill marimo-pair"
    ) in skill


def test_primary_skill_image_snippet_reads_selection_evidence() -> None:
    snapshot = _context()
    namespace: dict[str, object] = {"snapshot": snapshot}

    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/SKILL.md", "## Inspect the required evidence"
        ),
        namespace,
    )

    assert namespace["selection_png"] == b"selection-png"
    assert namespace["selection_status"] == "outdated"
    assert namespace["cell_png"] is None


def test_code_mode_reference_requests_cell_image_with_saved_revision() -> None:
    calls: list[tuple[str, int]] = []

    def cell_image(cell_id: str, *, expected_revision: int) -> bytes:
        calls.append((cell_id, expected_revision))
        return b"cell-png"

    namespace: dict[str, object] = {
        "mounted": SimpleNamespace(cell_image=cell_image),
        "cell_id": "cell-view",
        "revision": 4,
    }

    exec(  # noqa: S102 - Exercise the repository-owned reference example.
        _python_block(
            "skills/marimo-lens/reference/workflow.md",
            "## Capture a current cell image",
        ),
        namespace,
    )

    assert namespace["cell_png"] == b"cell-png"
    assert calls == [("cell-view", 4)]


def test_address_mode_builds_evidence_workset_for_every_selection() -> None:
    namespace: dict[str, object] = {"snapshot": _context()}

    exec(  # noqa: S102 - Exercise the canonical skill example.
        _python_block(
            "skills/marimo-lens/SKILL.md",
            "### Address every open selection",
        ),
        namespace,
    )

    value = namespace["address_workset"]
    assert isinstance(value, list)
    workset = cast(list[dict[str, Any]], value)
    assert [item["selection"]["id"] for item in workset] == [
        "selection-1",
        "selection-2",
    ]
    assert [item["selection_png"] for item in workset] == [
        b"selection-png",
        b"second-selection-png",
    ]


def _python_block(relative_path: str, heading: str) -> str:
    text = (REPOSITORY_ROOT / relative_path).read_text()
    section = text.split(f"{heading}\n", maxsplit=1)[1]
    match = re.search(r"```python\n(.*?)\n```", section, flags=re.DOTALL)
    assert match is not None
    return match.group(1)


def _context() -> LensContext:
    return LensContext(
        references={
            "revision": 4,
            "generatedAt": "2026-08-03T13:31:31Z",
            "notebook": {"path": "notebook.py", "available": True},
            "currentSelectionId": "selection-1",
            "selections": [
                {
                    "id": "selection-1",
                    "label": "S1",
                    "note": "",
                    "target": {"kind": "notebook", "cellIds": ["cell-view"]},
                    "cells": [{"id": "cell-view", "status": "available"}],
                    "anchor": {"kind": "point", "x": 0.5, "y": 0.5},
                    "snapshot": {"status": "outdated"},
                },
                {
                    "id": "selection-2",
                    "label": "S2",
                    "note": "Check the second mark",
                    "target": {"kind": "notebook", "cellIds": ["cell-view"]},
                    "cells": [{"id": "cell-view", "status": "available"}],
                    "anchor": {"kind": "point", "x": 0.75, "y": 0.5},
                    "snapshot": {"status": "available"},
                },
            ],
        },
        text="",
        images={
            "selection-1": b"selection-png",
            "selection-2": b"second-selection-png",
        },
    )
