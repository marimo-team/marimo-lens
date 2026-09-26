from __future__ import annotations

import inspect
import os
import pydoc
import subprocess
import sys
import traceback
from collections.abc import Mapping, Sequence
from importlib.metadata import distribution
from types import SimpleNamespace
from typing import cast

import agent_plugins as ap
import marimo as mo
import marimo._code_mode as code_mode
import pytest
from marimo_lens import ActivityHandle, Lens, LensContext, LensError, agent

from tests.support.factories import png


class _RuntimeScope:
    pass


@pytest.fixture(autouse=True)
def _active_runtime(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    import marimo._runtime.context as context_module

    state = SimpleNamespace(
        context=SimpleNamespace(ui_element_registry=_RuntimeScope())
    )
    monkeypatch.setattr(context_module, "get_context", lambda: state.context)
    return state


def test_agent_module_exports_the_handoff_surface() -> None:
    assert set(agent.__all__) == {
        "MountedLens",
        "add_lens_cell",
        "connect",
        "discover",
        "plugin",
        "skill",
    }


def test_marimo_code_mode_discovers_the_lens_capability() -> None:
    assert code_mode.capabilities()["lens"] == "marimo_lens.agent"


def test_agent_capability_entry_point_loads_the_instruction_module() -> None:
    capabilities = [
        entry_point
        for entry_point in distribution("marimo-lens").entry_points
        if entry_point.group == "marimo.agent.capability"
    ]

    assert [(entry.name, entry.value) for entry in capabilities] == [
        ("lens", "marimo_lens.agent")
    ]
    assert capabilities[0].load() is agent


def test_agent_resources_resolve_the_packaged_lens_skill() -> None:
    plugin = agent.plugin()
    skill = agent.skill()

    assert plugin.manifest.name == "marimo-lens"
    assert skill in plugin.skills
    assert skill.path.name == "marimo-lens"
    assert (skill / "SKILL.md").is_file()
    assert (skill / "agents" / "openai.yaml").is_file()
    assert skill.file("references/workflow.md").is_file()
    assert skill.frontmatter.splitlines()[0] == "name: marimo-lens"


def test_agent_module_help_contains_the_installed_core_briefing() -> None:
    plugin = agent.plugin()
    skill = agent.skill()
    rendered = pydoc.render_doc(agent)
    briefing = ap.read("marimo-lens")

    assert str(plugin.path) in rendered
    assert str(skill / "SKILL.md") in rendered
    assert agent.__doc__ == briefing
    assert skill.source in briefing
    assert "## Explain the notebook with a Trail" in rendered
    assert "references/selections.md" in rendered


@pytest.mark.parametrize(
    "import_statement", ["import marimo_lens", "import marimo_lens.agent"]
)
def test_package_import_exposes_agent_resources_and_help(import_statement: str) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                f"{import_statement}\n"
                "assert 'agent' in marimo_lens.__all__\n"
                "plugin = marimo_lens.agent.plugin()\n"
                "skill = marimo_lens.agent.skill()\n"
                "assert plugin.manifest.name == 'marimo-lens'\n"
                "assert skill == plugin.skill('marimo-lens')\n"
                "assert skill.file('references/selections.md').is_file()\n"
                "help(marimo_lens.agent)\n"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "marimo_lens.agent" in result.stdout


def test_module_help_carries_the_skill_through_a_windows_code_page() -> None:
    # A Windows kernel whose output is redirected reports the locale code page,
    # and pydoc's help() escapes characters that code page cannot encode.
    result = subprocess.run(
        [sys.executable, "-c", "import marimo_lens\nhelp(marimo_lens.agent)"],
        capture_output=True,
        env={**os.environ, "PYTHONIOENCODING": "cp1252"},
        check=True,
    )
    help_text = result.stdout.decode("cp1252")

    skill_lines = [
        line.strip() for line in agent.skill().body.splitlines() if line.strip()
    ]
    assert [line for line in skill_lines if line not in help_text] == []


def test_package_import_defers_reading_agent_resources() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import agent_plugins as ap\n"
                "read, locate = ap.read, ap.locate\n"
                "def unavailable(*args, **kwargs):\n"
                "    raise AssertionError('Unexpected resource access')\n"
                "ap.read = ap.locate = unavailable\n"
                "import marimo_lens\n"
                "assert callable(marimo_lens.agent.connect)\n"
                "ap.read, ap.locate = read, locate\n"
                "plugin = marimo_lens.agent.plugin()\n"
                "skill = marimo_lens.agent.skill()\n"
                "assert plugin.manifest.name == 'marimo-lens'\n"
                "assert skill == plugin.skill('marimo-lens')\n"
                "assert skill.source in marimo_lens.agent.__doc__\n"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_agent_handoff_matches_documented_signatures() -> None:
    assert list(inspect.signature(agent.add_lens_cell).parameters) == ["ctx"]
    assert list(inspect.signature(agent.connect).parameters) == ["context", "identity"]
    assert (
        inspect.signature(agent.connect).parameters["identity"].kind
        is inspect.Parameter.KEYWORD_ONLY
    )
    expected_parameters = {
        "context": ["self"],
        "cell_image": ["self", "cell_id", "expected_revision"],
        "start_activity": [
            "self",
            "target",
            "expected_revision",
            "duration_ms",
            "label",
            "message",
        ],
        "stop_activity": ["self", "activity"],
        "resolve": ["self", "selection_ids", "expected_revision", "summary"],
        "reveal": [
            "self",
            "target",
            "expected_revision",
            "duration_ms",
            "label",
            "message",
        ],
    }
    for method_name, expected in expected_parameters.items():
        parameters = inspect.signature(
            getattr(agent.MountedLens, method_name)
        ).parameters
        assert list(parameters) == expected

    assert (
        inspect.signature(agent.MountedLens.cell_image)
        .parameters["expected_revision"]
        .kind
        is inspect.Parameter.KEYWORD_ONLY
    )
    reveal_duration = inspect.signature(agent.MountedLens.reveal).parameters[
        "duration_ms"
    ]
    assert reveal_duration.kind is inspect.Parameter.KEYWORD_ONLY
    assert reveal_duration.default is inspect.Parameter.empty
    activity_duration = inspect.signature(agent.MountedLens.start_activity).parameters[
        "duration_ms"
    ]
    assert activity_duration.kind is inspect.Parameter.KEYWORD_ONLY
    assert activity_duration.default is None


def _set_mounted(lens: Lens, *, mounted: bool = True) -> None:
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.event",
            "version": 6,
            "type": f"output.capture.{'ready' if mounted else 'unready'}",
            "payload": {},
        },
        [],
    )


def _mounted_lens() -> Lens:
    lens = Lens()
    _set_mounted(lens)
    return lens


def _code_mode_context(**values: object) -> SimpleNamespace:
    return SimpleNamespace(globals=values)


def _marimo_wrapper(lens: Lens, monkeypatch: pytest.MonkeyPatch) -> object:
    import marimo._runtime.context as context_module
    from marimo._runtime.context import ContextNotInitializedError

    def unavailable() -> None:
        raise ContextNotInitializedError

    with monkeypatch.context() as construction:
        construction.setattr(context_module, "get_context", unavailable)
        return mo.ui.anywidget(lens)


def _lens_context(
    *,
    revision: int = 4,
    note: str = "Make this blue",
    images: Mapping[str, bytes] | None = None,
) -> LensContext:
    return LensContext(
        {
            "revision": revision,
            "notebook": {"path": "/workspace/demo.py", "available": True},
            "currentSelectionId": "selection-1",
            "selections": [
                {
                    "id": "selection-1",
                    "label": "S1",
                    "note": note,
                    "target": {
                        "kind": "notebook",
                        "cellIds": ["cell-view"],
                        "documentId": "document-1",
                        "documentPath": "/",
                    },
                    "cells": [{"id": "cell-view", "status": "available"}],
                    "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
                    "domHint": {"tag": "svg", "text": "Quarterly revenue"},
                    "snapshot": {"status": "available"},
                }
            ],
        },
        "full Lens context",
        images or {},
    )


def test_add_lens_cell_requires_a_code_mode_context() -> None:
    with pytest.raises(
        TypeError,
        match="context must be a live marimo code-mode context",
    ):
        agent.add_lens_cell(SimpleNamespace())


def test_add_lens_cell_reports_duplicate_generated_cells() -> None:
    class Cells:
        def find(self, _substring: str) -> list[SimpleNamespace]:
            return [
                SimpleNamespace(id="lens-1"),
                SimpleNamespace(id="lens-2"),
            ]

    context = SimpleNamespace(
        cells=Cells(),
        create_cell=lambda *_args, **_kwargs: "lens-3",
        run_cell=lambda _cell_id: None,
    )

    with pytest.raises(LensError) as raised:
        agent.add_lens_cell(context)

    assert raised.value.code == "lens_ambiguous"


@pytest.mark.parametrize(
    ("status", "runs"),
    [
        ("stale", ["lens-1"]),
        ("exception", ["lens-1"]),
        ("idle", []),
        ("queued", []),
    ],
)
def test_add_lens_cell_reruns_its_cell_unless_a_lens_is_live_or_pending(
    status: str, runs: list[str]
) -> None:
    queued: list[str] = []

    class Cells:
        def find(self, _substring: str) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="lens-1", status=status)]

    def create_cell(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("an existing Lens cell must be reused")

    context = SimpleNamespace(
        cells=Cells(),
        create_cell=create_cell,
        run_cell=queued.append,
    )

    assert agent.add_lens_cell(context) == "lens-1"
    assert queued == runs


def test_connect_preserves_identity_across_kernel_calls() -> None:
    lens = _mounted_lens()

    first = agent.connect()
    second = agent.connect(identity=first.identity)

    assert second.identity == first.identity
    with pytest.raises(LensError) as raised:
        agent.connect(identity="another-lens")
    assert raised.value.code == "lens_unavailable"
    assert raised.value.revision is None
    lens.close()


def test_connect_uses_an_existing_lens_from_the_code_mode_context() -> None:
    lens = Lens()
    context = _code_mode_context(lens=lens)

    mounted = agent.connect(context)
    reconnected = agent.connect(context, identity=mounted.identity)

    assert mounted.context().revision == 0
    assert reconnected.identity == mounted.identity
    lens.close()


def test_connect_deduplicates_context_and_browser_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lens = _mounted_lens()
    context = _code_mode_context(
        lens=lens,
        lens_alias=lens,
        wrapped=_marimo_wrapper(lens, monkeypatch),
    )

    assert agent.connect(context).identity == agent.connect().identity
    lens.close()


def test_connect_prefers_the_unique_browser_ready_lens_in_context() -> None:
    active = _mounted_lens()
    duplicate = Lens()
    context = _code_mode_context(active=active, duplicate=duplicate)

    available = agent.discover(context)
    active_handle = agent.connect()
    connected = agent.connect(context)
    duplicate_handle = next(
        (
            candidate
            for candidate in available
            if candidate.identity != active_handle.identity
        ),
        None,
    )

    assert connected.identity == active_handle.identity
    assert duplicate_handle is not None
    assert (
        agent.connect(context, identity=duplicate_handle.identity).identity
        == duplicate_handle.identity
    )
    active.close()
    duplicate.close()


def test_connect_uses_a_lens_held_by_a_marimo_wrapper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lens = Lens()
    context = _code_mode_context(wrapped=_marimo_wrapper(lens, monkeypatch))

    assert agent.connect(context).context().revision == 0
    lens.close()


def test_discover_lists_candidates_for_explicit_reconnection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = Lens()
    second = _mounted_lens()
    context = _code_mode_context(
        first=first,
        alias=first,
        second=_marimo_wrapper(second, monkeypatch),
    )
    handles = agent.discover(context)
    assert len({handle.identity for handle in handles}) == 2
    for handle in handles:
        assert (
            agent.connect(context, identity=handle.identity).identity == handle.identity
        )
    assert set(context.globals) == {"first", "alias", "second"}

    first.close()
    assert [handle.identity for handle in agent.discover(context)] == [
        agent.connect().identity
    ]
    second.close()
    assert agent.discover(context) == ()


def test_connect_reports_ambiguous_context_lenses() -> None:
    first = Lens()
    second = Lens()
    context = _code_mode_context(first=first, second=second)

    with pytest.raises(LensError) as raised:
        agent.connect(context)

    assert raised.value.code == "lens_ambiguous"
    first.close()
    second.close()


def test_connect_ignores_a_closed_context_lens() -> None:
    closed = Lens()
    available = Lens()
    closed.close()

    mounted = agent.connect(_code_mode_context(closed=closed, available=available))

    assert mounted.context().revision == 0
    available.close()


def test_unavailable_connection_reports_its_code_in_the_traceback() -> None:
    with pytest.raises(LensError) as raised:
        agent.connect(_code_mode_context())

    # Code-mode transports return an uncaught error as its formatted traceback.
    assert traceback.format_exception_only(raised.value)[-1] == (
        "marimo_lens.errors.LensError: lens_unavailable: "
        "No Lens is available in the active notebook.\n"
    )


def test_connect_uses_identity_to_select_an_available_context_lens() -> None:
    first = Lens()
    second = Lens()
    identity = agent.connect(_code_mode_context(first=first)).identity

    mounted = agent.connect(
        _code_mode_context(first=first, second=second),
        identity=identity,
    )

    assert mounted.identity == identity
    first.close()
    second.close()


def test_connect_requires_a_context_globals_mapping() -> None:
    with pytest.raises(TypeError, match="context must expose a globals mapping"):
        agent.connect(SimpleNamespace())


def test_connect_tracks_the_browser_mount_lifecycle() -> None:
    lens = Lens()
    assert agent.discover() == ()

    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"

    _set_mounted(lens)
    _set_mounted(lens)
    identity = agent.connect().identity
    assert [item.identity for item in agent.discover()] == [identity]

    _set_mounted(lens, mounted=False)
    assert agent.connect().identity == identity

    _set_mounted(lens, mounted=False)
    assert agent.discover() == ()
    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"
    lens.close()


def test_connected_handle_does_not_retarget_after_replacement() -> None:
    lens = _mounted_lens()
    mounted = agent.connect()
    identity = mounted.identity
    lens.close()

    replacement = _mounted_lens()
    with pytest.raises(LensError) as raised:
        mounted.context()

    assert raised.value.code == "lens_closed"
    assert agent.connect().identity != identity
    replacement.close()


def test_connect_reports_ambiguous_lenses() -> None:
    first = _mounted_lens()
    second = _mounted_lens()

    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_ambiguous"
    assert raised.value.revision is None
    first.close()
    second.close()


def test_connect_scopes_mounted_lenses_by_ui_registry(
    _active_runtime: SimpleNamespace,
) -> None:
    first_scope = _RuntimeScope()
    second_scope = _RuntimeScope()
    _active_runtime.context = SimpleNamespace(ui_element_registry=first_scope)

    first = Lens()
    _set_mounted(first)
    first_identity = agent.connect().identity
    _active_runtime.context = SimpleNamespace(ui_element_registry=second_scope)
    second = Lens()
    _set_mounted(second)
    second_identity = agent.connect().identity

    assert second_identity != first_identity
    _active_runtime.context = SimpleNamespace(ui_element_registry=first_scope)
    assert agent.connect().identity == first_identity
    assert [item.identity for item in agent.discover()] == [first_identity]

    first.close()
    second.close()


def _raise_runtime_context_error() -> object:
    raise RuntimeError("runtime context changed")


@pytest.mark.parametrize(
    "get_context",
    [
        pytest.param(lambda: SimpleNamespace(), id="missing-ui-registry"),
        pytest.param(_raise_runtime_context_error, id="context-read-failure"),
    ],
)
def test_mount_discovery_degrades_when_runtime_scope_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    get_context: object,
) -> None:
    import marimo._runtime.context as context_module

    monkeypatch.setattr(context_module, "get_context", get_context)
    lens = Lens()

    _set_mounted(lens)
    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"
    lens.close()


def test_connect_requires_a_string_identity() -> None:
    with pytest.raises(TypeError, match="identity must be a string or None"):
        agent.connect(identity=cast(str | None, 1))


def test_connect_requires_a_nonempty_identity() -> None:
    with pytest.raises(ValueError, match="identity must not be empty"):
        agent.connect(identity="")


def test_context_returns_the_current_snapshot_and_png_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png()
    lens = _mounted_lens()
    context_value = _lens_context(images={"selection-1": data})
    monkeypatch.setattr(Lens, "context", lambda _self: context_value)
    mounted = agent.connect()

    assert mounted.context().revision == 4
    assert mounted.context().images["selection-1"] == data
    lens.close()


def test_cell_image_forwards_the_raw_byte_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png(3, 2)
    lens = _mounted_lens()
    monkeypatch.setattr(Lens, "context", lambda _self: _lens_context())
    calls: list[tuple[str, int]] = []

    def cell_image(
        _lens: Lens,
        cell_id: str,
        *,
        expected_revision: int,
    ) -> bytes:
        calls.append((cell_id, expected_revision))
        return data

    monkeypatch.setattr(Lens, "_cell_image", cell_image)
    mounted = agent.connect()

    result = mounted.cell_image("cell-view", expected_revision=4)

    assert result == data
    assert calls == [("cell-view", 4)]
    lens.close()


def test_mounted_lens_forwards_attention_workflow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    lens = _mounted_lens()
    activity = ActivityHandle("1" * 32)

    def start_activity(
        _self: Lens,
        target: str,
        *,
        expected_revision: int | None = None,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> ActivityHandle:
        calls.append(("start", target, expected_revision, duration_ms, label, message))
        return activity

    def stop_activity(_self: Lens, owner: ActivityHandle) -> None:
        calls.append(("stop", owner))

    def reveal(
        _self: Lens,
        target: str,
        *,
        expected_revision: int | None = None,
        duration_ms: int,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        calls.append(("reveal", target, expected_revision, duration_ms, label, message))

    monkeypatch.setattr(Lens, "start_activity", start_activity)
    monkeypatch.setattr(Lens, "stop_activity", stop_activity)
    monkeypatch.setattr(Lens, "reveal", reveal)
    mounted = agent.connect()

    returned = mounted.start_activity(
        "cell-view",
        label="Updating aggregation",
        message="Applying the requested grouping.",
    )
    mounted.stop_activity(returned)
    mounted.reveal(
        "cell-view",
        label="Updated chart",
        message="Updated the chart and verified its labels.",
        duration_ms=8_000,
    )

    assert calls == [
        (
            "start",
            "cell-view",
            None,
            None,
            "Updating aggregation",
            "Applying the requested grouping.",
        ),
        ("stop", activity),
        (
            "reveal",
            "cell-view",
            None,
            8_000,
            "Updated chart",
            "Updated the chart and verified its labels.",
        ),
    ]
    lens.close()


def test_mounted_lens_returns_revision_for_sequential_resolution_groups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    lens = _mounted_lens()

    def resolve(
        _self: Lens,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        calls.append((selection_ids, expected_revision, summary))
        return expected_revision + 1

    monkeypatch.setattr(Lens, "resolve", resolve)
    mounted = agent.connect()

    revision = mounted.resolve(
        "selection-1",
        expected_revision=8,
        summary="Updated the first request and verified the chart.",
    )
    revision = mounted.resolve(
        "selection-2",
        expected_revision=revision,
        summary="Updated the second request and verified the chart.",
    )

    assert revision == 10
    assert calls == [
        (
            "selection-1",
            8,
            "Updated the first request and verified the chart.",
        ),
        (
            "selection-2",
            9,
            "Updated the second request and verified the chart.",
        ),
    ]
    lens.close()
