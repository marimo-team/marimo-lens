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
from marimo_lens import Lens
from marimo_lens._context.lens_context import LensContext

from tests.support.browser import BrowserLens
from tests.support.factories import lens_context, selection
from tests.support.kernel import FakeNotebook

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_primary_skill_opens_a_request_and_prints_the_brief_and_outline(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[object] = []
    request = {
        "id": "chat-1",
        "channel": "chat",
        "label": None,
        "note": "<the analyst's message, quoted>",
        "cells": [],
    }
    context = SimpleNamespace(revision=4, request=request, brief="Revenue request")
    ctx = SimpleNamespace(
        cells=[
            SimpleNamespace(
                id="Hbol", name="revenue", status="idle", code="revenue = sales.sum()"
            ),
            SimpleNamespace(
                id="lEQa", name="chart", status="idle", code="chart = plot(revenue)"
            ),
        ]
    )

    def open_request(note: str, cells: object = None) -> str:
        calls.append(("open", note, cells))
        return "chat-1"

    def read_context() -> SimpleNamespace:
        calls.append("context")
        return context

    mounted = SimpleNamespace(
        identity="lens-a", open_request=open_request, context=read_context
    )

    def connect(value: object) -> SimpleNamespace:
        assert value is ctx
        return mounted

    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "connect", connect)
    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block(
            "skills/marimo-lens/SKILL.md", "## Start: request, brief, and code together"
        ),
        {},
    )

    assert calls == [("open", "<the analyst's message, quoted>", None), "context"]
    header, brief, *outline = capsys.readouterr().out.splitlines()
    assert ast.literal_eval(header) == {
        "identity": "lens-a",
        "revision": 4,
        "request": request,
    }
    assert brief == "Revenue request"
    assert outline == [
        "Hbol revenue idle ['revenue = sales.sum()']",
        "lEQa chart idle ['chart = plot(revenue)']",
    ]


def test_primary_skill_keeps_a_dom_request_with_no_producers_targeted(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    FakeNotebook(monkeypatch, tmp_path / "report.py", {"unrelated": "value = 1"})
    lens = BrowserLens(dom_selector="#report")
    lens.put(
        selection(
            note="Check the heading",
            target={
                "kind": "dom",
                "cellIds": [],
                "sources": [],
                "documentId": "document-1",
                "documentPath": "/",
                "domSelector": "#report",
            },
        )
    )
    ctx = SimpleNamespace(
        globals={},
        cells=[
            SimpleNamespace(
                id="unrelated", name="outside", status="idle", code="value = 1"
            )
        ],
    )
    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    code = _python_block(
        "skills/marimo-lens/SKILL.md", "## Start: request, brief, and code together"
    ).replace('mounted.open_request("<the analyst\'s message, quoted>")\n', "")

    exec(code, {})  # noqa: S102 - Exercise the documented selection variant.

    header, brief = capsys.readouterr().out.split("\n", maxsplit=1)
    assert ast.literal_eval(header)["request"] == {
        "id": "selection-1",
        "channel": "selection",
        "label": "S1",
        "note": "Check the heading",
        "cells": [],
    }
    assert brief.rstrip() == lens.context().brief
    lens.close()


def test_primary_skill_captures_visual_verification_through_the_host(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[tuple[str, str]] = []

    async def screenshot(cell_id: str, *, save_to: str) -> bytes:
        calls.append((cell_id, save_to))
        return b"cell-png"

    ctx = SimpleNamespace(
        cells={"Hbol": SimpleNamespace(id="Hbol", status="idle", errors=[])},
        screenshot=screenshot,
    )
    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    code = _python_block("skills/marimo-lens/SKILL.md", "## Verify visual edits")
    namespace: dict[str, Any] = {}
    exec(  # noqa: S102 - Exercise the host screenshot recipe.
        "async def run():\n" + indent(code, "    "), namespace
    )
    asyncio.run(namespace["run"]())

    assert calls == [("Hbol", "/tmp/lens-output.png")]
    assert capsys.readouterr().out.strip() == "/tmp/lens-output.png"


def test_primary_skill_edits_the_inspected_body_and_queues_its_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, ...]] = []
    ctx = SimpleNamespace(
        edit_cell=lambda cell_id, body: calls.append(("edit", cell_id, body)),
        run_cell=lambda cell_id: calls.append(("run", cell_id)),
    )

    @asynccontextmanager
    async def get_context() -> AsyncGenerator[SimpleNamespace, None]:
        yield ctx

    monkeypatch.setattr(code_mode, "get_context", get_context)
    namespace: dict[str, Any] = {}
    code = _python_block("skills/marimo-lens/SKILL.md", "## Inspect and edit")
    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        "async def run():\n" + indent(code, "    "), namespace
    )

    asyncio.run(namespace["run"]())

    assert calls == [
        ("edit", "Hbol", "revenue = sales[sales.kind != 'refund'].sum()"),
        ("run", "Hbol"),
    ]


def test_primary_skill_tour_reveals_labeled_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []
    mounted = lens_agent.MountedLens(
        "F3n...",
        cast(
            Lens,
            SimpleNamespace(
                reveal=lambda steps, **kwargs: calls.append((steps, kwargs))
            ),
        ),
    )
    ctx = object()

    def connect(value: object, *, identity: str) -> lens_agent.MountedLens:
        assert value is ctx
        assert identity == "F3n..."
        return mounted

    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "connect", connect)
    exec(  # noqa: S102 - Exercise the repository-owned skill example.
        _python_block("skills/marimo-lens/SKILL.md", "## Notebook tours"),
        {},
    )

    [call] = calls
    steps, options = cast(tuple[list[dict[str, str]], dict[str, object]], call)
    assert [step["target"] for step in steps] == ["Hbol", "lEQa"]
    assert all(step["label"] and step["message"] for step in steps)
    assert options == {
        "expected_revision": None,
        "label": None,
        "message": None,
        "duration_ms": None,
    }


def test_primary_skill_image_snippet_reads_selection_evidence() -> None:
    namespace: dict[str, object] = {"context": _context()}

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
    context = SimpleNamespace(
        revision=8,
        references={"selections": [selection]},
    )

    def reveal(selection: object, **kwargs: object) -> None:
        calls.append(("reveal", selection, kwargs))

    def resolve(selection_ids: list[str], **kwargs: object) -> int:
        calls.append(("resolve", selection_ids, kwargs))
        return 9

    mounted = SimpleNamespace(
        context=lambda: context,
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
    namespace: dict[str, object] = {"context": _context()}

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


@pytest.mark.parametrize(
    ("status", "errors", "warning_cell", "warning_request", "blocked"),
    [
        pytest.param("idle", [], "Badx", "selection-other", False, id="unrelated"),
        pytest.param("idle", [], "Hbol", "selection-other", True, id="on-cell"),
        pytest.param("idle", [], "Badx", "chat-...", True, id="on-request"),
        pytest.param("idle", [], None, None, True, id="unplaced"),
        pytest.param("running", [], "Badx", "selection-other", False, id="running"),
        pytest.param(
            "idle",
            ["Invalid revenue input"],
            "Badx",
            "selection-other",
            False,
            id="errors",
        ),
    ],
)
def test_primary_skill_finishes_verified_work_with_the_saved_request(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    status: str,
    errors: list[str],
    warning_cell: str | None,
    warning_request: str | None,
    blocked: bool,
) -> None:
    calls: list[tuple[str, object, dict[str, object]]] = []
    ctx = SimpleNamespace(
        cells={"Hbol": SimpleNamespace(id="Hbol", status=status, errors=errors)}
    )
    context = _context()

    def check() -> list[object]:
        calls.append(("check", None, {}))
        return [
            {
                "severity": "warning",
                "cellId": warning_cell,
                "requestId": warning_request,
            }
        ]

    def resolve(request_id: str, **kwargs: object) -> int:
        calls.append(("resolve", request_id, kwargs))
        return context.revision

    mounted = lens_agent.MountedLens(
        "F3n...",
        cast(
            Lens,
            SimpleNamespace(
                context=lambda: context,
                check=check,
                reveal=lambda target, **kwargs: calls.append(
                    ("reveal", target, kwargs)
                ),
                resolve=resolve,
            ),
        ),
    )

    def connect(value: object, *, identity: str) -> lens_agent.MountedLens:
        assert value is ctx
        assert identity == "F3n..."
        return mounted

    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "connect", connect)
    code = _python_block(
        "skills/marimo-lens/SKILL.md", "## Finish: verify, reveal, resolve"
    )
    if status != "idle" or errors:
        with pytest.raises(AssertionError):
            exec(code, {})  # noqa: S102 - Exercise the repository-owned skill example.
        assert calls == []
        return

    if blocked:
        with pytest.raises(RuntimeError, match="Review affected Lens warnings"):
            exec(code, {})  # noqa: S102 - Exercise the repository-owned skill example.
        assert calls == [("check", None, {})]
        return

    exec(code, {})  # noqa: S102 - Exercise the repository-owned skill example.

    checked, (reveal, target, reveal_kwargs), (resolved, request_id, kwargs) = calls
    assert checked == ("check", None, {})
    assert (reveal, resolved) == ("reveal", "resolve")
    assert target == "Hbol"
    assert reveal_kwargs["label"] and reveal_kwargs["message"]
    assert reveal_kwargs["duration_ms"] == 4_000
    assert request_id == "chat-..."
    assert kwargs["expected_revision"] == 4
    assert kwargs["summary"]
    diagnostic_output, revision_output = capsys.readouterr().out.splitlines()
    assert ast.literal_eval(diagnostic_output) == [
        {"severity": "warning", "cellId": "Badx", "requestId": "selection-other"}
    ]
    assert revision_output == "4"


def test_selection_reference_lists_open_selections_for_another_session(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    ctx = object()

    def discover(context: object) -> tuple[SimpleNamespace, ...]:
        assert context is ctx
        return (SimpleNamespace(identity="lens-a", context=_context),)

    monkeypatch.setattr(code_mode, "get_context", lambda: ctx)
    monkeypatch.setattr(lens_agent, "discover", discover)
    exec(  # noqa: S102 - Exercise the repository-owned reference example.
        _python_block(
            "skills/marimo-lens/references/selections.md",
            "### Selections in other notebooks",
        ),
        {},
    )

    assert json.loads(capsys.readouterr().out) == [
        {"identity": "lens-a", "id": "selection-1", "label": "S1", "note": ""},
        {
            "identity": "lens-a",
            "id": "selection-2",
            "label": "S2",
            "note": "Check the second mark",
        },
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


def _context(brief: str = "") -> LensContext:
    return lens_context(
        {
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
                    "cells": [
                        {"id": "cell-view", "status": "available", "codeHash": None}
                    ],
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
                    "cells": [
                        {"id": "cell-view", "status": "available", "codeHash": None}
                    ],
                    "anchor": {"kind": "point", "x": 0.75, "y": 0.5},
                    "snapshot": {"status": "available"},
                },
            ],
        },
        text="",
        brief=brief,
        images={
            "selection-1": b"selection-png",
            "selection-2": b"second-selection-png",
        },
    )
