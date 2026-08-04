from __future__ import annotations

import re
from pathlib import Path
from typing import Any, cast

from marimo_lens.context import LensContext

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


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


def test_workflow_image_snippet_executes_against_lens_context() -> None:
    namespace: dict[str, object] = {"snapshot": _context()}

    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/reference/workflow.md",
            "## Inspect selection evidence",
        ),
        namespace,
    )

    assert namespace["selection_png"] == b"selection-png"
    assert namespace["selection_status"] == "outdated"


def test_address_mode_builds_evidence_workset_for_every_selection() -> None:
    for relative_path in (
        "skills/marimo-lens/SKILL.md",
        "skills/marimo-lens/reference/workflow.md",
    ):
        namespace: dict[str, object] = {"snapshot": _context()}

        exec(  # noqa: S102 - Exercise the repository-owned skill example.
            _python_block(relative_path, "### Address every open selection"),
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
                    "outputCellId": "cell-view",
                    "cellStatus": "available",
                    "anchor": {"kind": "point", "x": 0.5, "y": 0.5},
                    "snapshot": {"status": "outdated"},
                },
                {
                    "id": "selection-2",
                    "label": "S2",
                    "note": "Check the second mark",
                    "outputCellId": "cell-view",
                    "cellStatus": "available",
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
