from __future__ import annotations

import re
from pathlib import Path

from marimo_lens.context import LensContext

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


class _MountedLens:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def cell_image(self, cell_id: str, *, expected_revision: int) -> bytes:
        self.calls.append((cell_id, expected_revision))
        return b"cell-png"


def test_primary_skill_image_snippet_executes_against_lens_context() -> None:
    snapshot = _context()
    mounted = _MountedLens()
    namespace: dict[str, object] = {"mounted": mounted, "snapshot": snapshot}

    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/SKILL.md", "## Inspect the required evidence"
        ),
        namespace,
    )

    assert namespace["selection_png"] == b"selection-png"
    assert namespace["selection_status"] == "outdated"
    assert namespace["cell_png"] == b"cell-png"
    assert mounted.calls == [("cell-view", 4)]


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
                }
            ],
        },
        text="",
        images={"selection-1": b"selection-png"},
    )
