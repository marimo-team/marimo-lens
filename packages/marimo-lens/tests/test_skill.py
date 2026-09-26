from __future__ import annotations

import ast
import asyncio
import json
import re
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from textwrap import indent
from types import SimpleNamespace
from typing import Any, cast

import marimo._code_mode as code_mode
import marimo_lens.agent as lens_agent
import pytest
from marimo_lens.context import LensContext

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("already_mounted", [False, True])
def test_primary_skill_mounts_only_when_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    already_mounted: bool,
) -> None:
    ctx = object()
    added: list[object] = []

    @asynccontextmanager
    async def context() -> AsyncGenerator[object, None]:
        yield ctx

    def discover(context: object) -> tuple[SimpleNamespace, ...]:
        assert context is ctx
        return (SimpleNamespace(identity="existing"),) if already_mounted else ()

    def add(context: object) -> str:
        added.append(context)
        return "lens-cell"

    monkeypatch.setattr(code_mode, "get_context", context)
    monkeypatch.setattr(lens_agent, "discover", discover)
    monkeypatch.setattr(lens_agent, "add_lens_cell", add)
    code = _python_block("skills/marimo-lens/SKILL.md", "## Add Lens when missing")
    namespace: dict[str, Any] = {}
    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        "async def run():\n" + indent(code, "    "), namespace
    )
    asyncio.run(namespace["run"]())

    assert added == ([] if already_mounted else [ctx])
    assert ast.literal_eval(capsys.readouterr().out) == (
        {"identities": ["existing"]} if already_mounted else {"cell_id": "lens-cell"}
    )


def test_primary_skill_walkthrough_runs_with_fresh_bindings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []
    context = SimpleNamespace(
        cells={
            name: SimpleNamespace(id=name, status="idle", errors=[])
            for name in ("inputs", "analysis", "summary")
        },
        graph=SimpleNamespace(cells=dict.fromkeys(("inputs", "analysis", "summary"))),
    )

    def connect(ctx: object) -> SimpleNamespace:
        assert ctx is context
        return SimpleNamespace(
            reveal=lambda steps, **kwargs: calls.append((steps, kwargs))
        )

    monkeypatch.setattr(code_mode, "get_context", lambda: context)
    monkeypatch.setattr(lens_agent, "connect", connect)
    namespace: dict[str, Any] = {}
    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/SKILL.md", "## Explain the notebook with a Trail"
        ),
        namespace,
    )

    assert len(calls) == 1
    steps, options = cast(tuple[list[dict[str, str]], dict[str, object]], calls[0])
    assert [step["target"] for step in steps] == ["inputs", "analysis", "summary"]
    assert all(step["label"] and step["message"] for step in steps)
    assert options == {"duration_ms": None}


def test_primary_skill_image_snippet_reads_selection_evidence() -> None:
    snapshot = _context()
    namespace: dict[str, object] = {"snapshot": snapshot}

    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/references/selections.md",
            "## Inspect the required evidence",
        ),
        namespace,
    )

    assert namespace["selection_png"] == b"selection-png"
    assert namespace["selection_status"] == "outdated"
    assert namespace["cell_png"] is None


def test_primary_skill_starts_activity_against_the_selection() -> None:
    calls: list[tuple[object, ...]] = []
    expected_selection = _context().current
    assert expected_selection is not None

    def start_activity(selection: object, **kwargs: object) -> str:
        calls.append((selection, kwargs))
        return "activity-owner"

    mounted = SimpleNamespace(
        context=_context,
        start_activity=start_activity,
    )
    namespace: dict[str, object] = {"mounted": mounted}
    exec(  # noqa: S102 - Exercise the canonical skill example.
        _code_mode_block(
            "skills/marimo-lens/references/selections.md",
            "## Start meaningful activity",
        ),
        namespace,
    )

    selection, raw_kwargs = calls[0]
    kwargs = cast(dict[str, object], raw_kwargs)
    assert namespace["activity"] == "activity-owner"
    assert selection == expected_selection
    assert kwargs["expected_revision"] == 4
    assert isinstance(kwargs["label"], str) and kwargs["label"]
    assert isinstance(kwargs["message"], str) and kwargs["message"]


@pytest.mark.parametrize("ready", [False, True])
def test_code_mode_reference_requests_cell_image_with_saved_revision(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    ready: bool,
) -> None:
    calls: list[tuple[str, int]] = []

    def cell_image(cell_id: str, *, expected_revision: int) -> bytes | None:
        calls.append((cell_id, expected_revision))
        return b"cell-png" if ready else None

    ctx = object()

    def connect(context: object, *, identity: str) -> SimpleNamespace:
        assert context is ctx
        assert identity == "F3n..."
        return SimpleNamespace(cell_image=cell_image)

    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "connect", connect)
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    namespace: dict[str, object] = {}

    exec(  # noqa: S102 - Exercise the repository-owned reference example.
        _python_block(
            "skills/marimo-lens/references/workflow.md",
            "## Capture a current cell image",
        ),
        namespace,
    )

    assert calls == [("BYtC", 8)]
    output = capsys.readouterr().out.strip()
    if ready:
        image_path = Path(output)
        assert image_path.parent == tmp_path
        assert image_path.read_bytes() == b"cell-png"
    else:
        assert output == "capture_pending"
        assert list(tmp_path.iterdir()) == []


def test_code_mode_reference_resolves_after_reveal_with_captured_revision(
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[tuple[object, ...]] = []
    selection = _context().references["selections"][0].copy()
    selection["id"] = "243110..."
    snapshot = SimpleNamespace(
        revision=8,
        references={"selections": [selection]},
    )

    def reveal(selection: object, **kwargs: object) -> None:
        calls.append(("reveal", selection, kwargs))

    def resolve(selection_ids: list[str], **kwargs: object) -> int:
        calls.append(("resolve", selection_ids, kwargs))
        return 9

    mounted = SimpleNamespace(
        context=lambda: snapshot,
        reveal=reveal,
        resolve=resolve,
    )
    namespace: dict[str, object] = {"mounted": mounted}
    exec(  # noqa: S102 - Exercise the repository-owned reference example.
        _code_mode_block(
            "skills/marimo-lens/references/workflow.md",
            "## Present and resolve across calls",
        ),
        namespace,
    )

    assert len(calls) == 2
    assert calls[0][:2] == ("reveal", selection)
    reveal_kwargs = cast(dict[str, object], calls[0][2])
    assert reveal_kwargs["expected_revision"] == 8
    assert calls[1][:2] == ("resolve", [selection["id"]])
    resolve_kwargs = cast(dict[str, object], calls[1][2])
    assert resolve_kwargs["expected_revision"] == reveal_kwargs["expected_revision"]
    summary = resolve_kwargs["summary"]
    assert isinstance(summary, str) and summary.strip()
    handoff = ast.literal_eval(capsys.readouterr().out)
    assert handoff == {
        "revision": 9,
        "hold_ms": reveal_kwargs["duration_ms"],
    }
    assert isinstance(reveal_kwargs["label"], str) and reveal_kwargs["label"]
    assert isinstance(reveal_kwargs["message"], str) and reveal_kwargs["message"]


def test_address_mode_builds_evidence_workset_for_every_selection() -> None:
    namespace: dict[str, object] = {"snapshot": _context()}

    exec(  # noqa: S102 - Exercise the canonical skill example.
        _python_block(
            "skills/marimo-lens/references/selections.md",
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


def test_pair_reference_heredoc_prints_the_connected_lens(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    ctx = object()

    def connect(context: object) -> SimpleNamespace:
        assert context is ctx
        return SimpleNamespace(identity="lens-a", context=_context)

    text = (REPOSITORY_ROOT / "skills/marimo-lens/references/setup.md").read_text()
    section = text.split("## Run Lens through marimo pair\n", maxsplit=1)[1]
    match = re.search(
        r"```bash\nmarimo pair execute .*?<<'PY'\n(.*?)\nPY\n```", section, re.DOTALL
    )
    assert match is not None
    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "connect", connect)
    exec(match.group(1), {})  # noqa: S102 - Exercise the repository-owned reference example.

    assert json.loads(capsys.readouterr().out) == {"identity": "lens-a", "revision": 4}


def _python_block(relative_path: str, heading: str) -> str:
    text = (REPOSITORY_ROOT / relative_path).read_text()
    section = text.split(f"{heading}\n", maxsplit=1)[1]
    match = re.search(r"```python\n(.*?)\n```", section, flags=re.DOTALL)
    assert match is not None
    return match.group(1)


def _code_mode_block(relative_path: str, heading: str) -> str:
    code = _python_block(relative_path, heading)
    lines = [
        line
        for line in code.splitlines()
        if line
        not in {
            "import marimo._code_mode as cm",
            "import marimo_lens",
        }
        and not line.startswith("mounted = marimo_lens.agent.connect(")
    ]
    return "\n".join(lines)


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
                    "target": {
                        "kind": "notebook",
                        "cellIds": ["cell-view"],
                        "documentId": "document-1",
                        "documentPath": "/",
                    },
                    "cells": [{"id": "cell-view", "status": "available"}],
                    "anchor": {"kind": "point", "x": 0.5, "y": 0.5},
                    "snapshot": {"status": "outdated"},
                },
                {
                    "id": "selection-2",
                    "label": "S2",
                    "note": "Check the second mark",
                    "target": {
                        "kind": "notebook",
                        "cellIds": ["cell-view"],
                        "documentId": "document-1",
                        "documentPath": "/",
                    },
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
