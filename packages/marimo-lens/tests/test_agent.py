from __future__ import annotations

import os
import pydoc
import subprocess
import sys
import traceback
from importlib import import_module
from importlib.metadata import distribution
from types import ModuleType, SimpleNamespace
from typing import Any, cast

import agent_plugins as ap
import marimo as mo
import marimo._code_mode as code_mode
import pytest
from marimo_lens import Lens, LensError, Record, agent
from marimo_lens._marimo.adapter import MarimoRuntimeAdapter
from marimo_lens._protocol.messages import PROTOCOL_VERSION

from tests.support.browser import BrowserLens
from tests.support.factories import png, selection


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


def test_marimo_code_mode_loads_the_registered_lens_capability() -> None:
    [capability] = [
        entry_point
        for entry_point in distribution("marimo-lens").entry_points
        if entry_point.group == "marimo.agent.capability"
    ]

    assert (capability.name, capability.value) == ("lens", "marimo_lens._capability")
    assert capability.load() is import_module(code_mode.capabilities()["lens"])


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


def test_capability_help_contains_the_installed_core_briefing() -> None:
    plugin = agent.plugin()
    skill = agent.skill()
    capability = import_module(code_mode.capabilities()["lens"])
    rendered = pydoc.plain(pydoc.render_doc(capability))
    briefing = ap.read("marimo-lens")
    instructions = capability.__doc__
    inventory = briefing.split("```text\n", 1)[1].split("\n```", 1)[0]

    assert str(plugin.path) in rendered
    assert str(skill / "SKILL.md") in rendered
    assert instructions is not None
    assert inventory in instructions
    assert skill.source in instructions
    assert skill.source in briefing
    assert all(line.strip() in rendered for line in skill.body.splitlines())
    for resource in (
        "plugin.json",
        "openai.yaml",
        "selections.md",
        "setup.md",
        "targets.md",
        "workflow.md",
        "SKILL.md",
    ):
        assert resource in rendered


def test_capability_help_fits_the_external_provider_output_limit() -> None:
    capability = import_module(code_mode.capabilities()["lens"])
    rendered = pydoc.plain(pydoc.render_doc(capability))

    assert len(rendered) < 10_000


def test_capability_help_reads_the_installed_briefing_once_per_retrieval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = import_module(code_mode.capabilities()["lens"])
    reads: list[str] = []

    def read(distribution_name: str) -> str:
        reads.append(distribution_name)
        return f"## Plugin inventory\n\nInstalled Lens briefing {len(reads)}"

    monkeypatch.setattr(ap, "read", read)
    first = pydoc.plain(pydoc.render_doc(capability))
    assert reads == ["marimo-lens"]
    assert "Installed Lens briefing 1" in first
    second = pydoc.plain(pydoc.render_doc(capability))
    assert reads == ["marimo-lens", "marimo-lens"]
    assert "Installed Lens briefing 2" in second


def test_agent_module_help_exposes_the_python_api() -> None:
    rendered = pydoc.plain(pydoc.render_doc(agent))

    assert type(agent) is ModuleType
    assert "Connect code-mode agents to Lens." in rendered
    assert "connect(context:" in rendered
    assert "*, identity:" in rendered
    assert "cell_image(self, cell_id:" in rendered
    assert "*, expected_revision:" in rendered
    assert "Return a fresh unannotated cell PNG across kernel calls." in rendered
    assert "then repeat the call" in rendered


def test_capability_help_carries_the_skill_through_a_windows_code_page() -> None:
    # A Windows kernel whose output is redirected reports the locale code page,
    # and pydoc's help() escapes characters that code page cannot encode.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import importlib\n"
                "import marimo._code_mode as cm\n"
                "help(importlib.import_module(cm.capabilities()['lens']))"
            ),
        ],
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
                "from importlib import import_module\n"
                "from importlib.metadata import distribution\n"
                "import marimo._code_mode as cm\n"
                "import marimo_lens\n"
                "assert callable(marimo_lens.agent.connect)\n"
                "module_name = cm.capabilities()['lens']\n"
                "capability = next(\n"
                "    entry for entry in distribution('marimo-lens').entry_points\n"
                "    if entry.group == 'marimo.agent.capability' and entry.name == 'lens'\n"
                ").load()\n"
                "assert capability is import_module(module_name)\n"
                "ap.read, ap.locate = read, locate\n"
                "plugin = marimo_lens.agent.plugin()\n"
                "skill = marimo_lens.agent.skill()\n"
                "assert plugin.manifest.name == 'marimo-lens'\n"
                "assert skill == plugin.skill('marimo-lens')\n"
                "assert skill.source in capability.__doc__\n"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def _unmount(lens: Lens) -> None:
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.event",
            "version": PROTOCOL_VERSION,
            "type": "output.capture.unready",
            "payload": {},
        },
        [],
    )


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
    ("status", "cell_lens", "runs"),
    [
        ("stale", None, ["lens-1"]),
        ("exception", None, ["lens-1"]),
        ("idle", "closed", ["lens-1"]),
        ("idle", "open", []),
        ("queued", None, []),
    ],
)
def test_add_lens_cell_reruns_its_cell_unless_it_holds_an_open_lens(
    _active_runtime: SimpleNamespace,
    status: str,
    cell_lens: str | None,
    runs: list[str],
) -> None:
    lens = None
    if cell_lens is not None:
        _active_runtime.context.execution_context = SimpleNamespace(cell_id="lens-1")
        lens = Lens()
        _active_runtime.context.execution_context = None
        if cell_lens == "closed":
            lens.close()
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
    if lens is not None:
        lens.close()


@pytest.mark.parametrize(
    ("record", "constructor"),
    [
        (None, "_Lens()"),
        (False, "_Lens()"),
        (True, "_Lens(record=True)"),
        (Record(), "_Lens(record=True)"),
        ({"keep": "notebook"}, "_Lens(record=True)"),
        (
            {"keep": "session", "images": False},
            '_Lens(record={"keep": "session", "images": False})',
        ),
        (Record(history=False), '_Lens(record={"history": False})'),
    ],
)
def test_add_lens_cell_writes_the_shortest_lens_constructor(
    monkeypatch: pytest.MonkeyPatch, record: Any, constructor: str
) -> None:
    created: list[str] = []

    def create_cell(code: str, **_kwargs: object) -> str:
        created.append(code)
        return "lens-cell"

    cell_id = agent.add_lens_cell(
        SimpleNamespace(
            cells=SimpleNamespace(find=lambda _marker: []),
            create_cell=create_cell,
            run_cell=lambda _cell_id: None,
        ),
        record=record,
    )

    [code] = created
    assert cell_id == "lens-cell"
    assert f"_lens = {constructor}\n" in code
    assert "Record" not in code
    mounted: list[Lens] = []
    monkeypatch.setattr(mo.output, "append", mounted.append)
    exec(code, {})  # noqa: S102 - execute the generated notebook cell
    assert mounted[0].record == Lens(record=record).record
    mounted[0].close()


def _existing_lens_cell(code: str) -> SimpleNamespace:
    class Cells:
        def find(self, _substring: str) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="lens-1", status="queued", code=code)]

    def create_cell(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("an existing Lens cell must be reused")

    return SimpleNamespace(
        cells=Cells(), create_cell=create_cell, run_cell=lambda _cell_id: None
    )


RECORD_CELL = """# marimo-lens: agent-managed Lens cell
import marimo as _mo
from marimo_lens import Lens as _Lens

_lens = _Lens(record={"keep": "session"})
_mo.output.append(_lens)
"""


@pytest.mark.parametrize("record", [None, {"keep": "session"}, Record(keep="session")])
def test_add_lens_cell_reuses_a_cell_that_keeps_the_same_record(
    record: object,
) -> None:
    context = _existing_lens_cell(RECORD_CELL)

    assert agent.add_lens_cell(context, record=cast(Any, record)) == "lens-1"


@pytest.mark.parametrize("record", [False, True, {"images": False}])
def test_add_lens_cell_refuses_a_record_its_existing_cell_does_not_keep(
    record: object,
) -> None:
    context = _existing_lens_cell(RECORD_CELL)

    with pytest.raises(LensError) as raised:
        agent.add_lens_cell(context, record=cast(Any, record))

    assert raised.value.code == "lens_cell_exists"
    assert 'Lens(record={"keep": "session"})' in str(raised.value)


def test_add_lens_cell_validates_the_record() -> None:
    context = SimpleNamespace(
        cells=SimpleNamespace(find=lambda _marker: []),
        create_cell=lambda *_args, **_kwargs: "lens-cell",
        run_cell=lambda _cell_id: None,
    )

    with pytest.raises(TypeError, match="'show'"):
        agent.add_lens_cell(context, record=cast(Any, {"show": False}))


def test_connect_preserves_identity_across_kernel_calls() -> None:
    lens = BrowserLens()

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
    lens = BrowserLens()
    context = _code_mode_context(
        lens=lens,
        lens_alias=lens,
        wrapped=_marimo_wrapper(lens, monkeypatch),
    )

    assert agent.connect(context).identity == agent.connect().identity
    lens.close()


def test_connect_prefers_the_unique_browser_ready_lens_in_context() -> None:
    active = BrowserLens()
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
    second = BrowserLens()
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

    assert traceback.format_exception_only(raised.value)[-1].startswith(
        "marimo_lens.LensError: lens_unavailable: "
    )


def test_connect_requires_a_context_globals_mapping() -> None:
    with pytest.raises(TypeError, match="context must expose a globals mapping"):
        agent.connect(SimpleNamespace())


def test_connect_tracks_the_browser_mount_lifecycle() -> None:
    lens = BrowserLens(displayed=False)
    assert agent.discover() == ()

    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"

    lens.display()
    lens.display()
    identity = agent.connect().identity
    assert [item.identity for item in agent.discover()] == [identity]

    _unmount(lens)
    assert agent.connect().identity == identity

    _unmount(lens)
    assert agent.discover() == ()
    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"
    lens.close()


def test_connected_handle_does_not_retarget_after_replacement() -> None:
    lens = BrowserLens()
    mounted = agent.connect()
    identity = mounted.identity
    lens.close()

    replacement = BrowserLens()
    with pytest.raises(LensError) as raised:
        mounted.context()

    assert raised.value.code == "lens_closed"
    assert agent.connect().identity != identity
    replacement.close()


def test_connect_reports_ambiguous_lenses() -> None:
    first = BrowserLens()
    second = BrowserLens()

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

    first = BrowserLens()
    first_identity = agent.connect().identity
    _active_runtime.context = SimpleNamespace(ui_element_registry=second_scope)
    second = BrowserLens()
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
    lens = BrowserLens()

    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"
    lens.close()


@pytest.mark.parametrize(
    ("identity", "error"), [(1, TypeError), ("", ValueError)], ids=["type", "empty"]
)
def test_connect_validates_the_identity(
    identity: object, error: type[Exception]
) -> None:
    with pytest.raises(error, match="identity must"):
        agent.connect(identity=cast(str | None, identity))


def test_mounted_lens_drives_the_lens_it_connects_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        MarimoRuntimeAdapter, "cell_status", lambda _self, _cell_id: "available"
    )
    lens = BrowserLens()
    data = png()
    lens.put(selection(), image=data)
    mounted = agent.connect()

    assert mounted.context().images == {"selection-1": data}
    activity = mounted.start_activity(
        "cell-view", label="Updating", message="Applying the grouping."
    )
    started = lens.sent[-1][0]["payload"]
    mounted.stop_activity(activity)
    stopped = lens.sent[-1][0]["payload"]
    mounted.reveal("cell-view", duration_ms=8_000, label="Updated", message="Done.")
    revealed = lens.sent[-1][0]["payload"]
    with pytest.raises(LensError) as stale:
        mounted.cell_image("cell-view", expected_revision=0)
    assert mounted.cell_image("cell-view", expected_revision=1) is None
    capture = lens.sent[-1][0]

    assert (started["label"], started["message"]) == (
        "Updating",
        "Applying the grouping.",
    )
    assert stopped == {"activityId": started["activityId"]}
    assert revealed["durationMs"] == 8_000
    assert revealed["steps"] == [
        {
            "address": {"kind": "cell", "cellId": "cell-view"},
            "label": "Updated",
            "message": "Done.",
        }
    ]
    assert stale.value.code == "revision_conflict"
    assert (capture["type"], capture["payload"]) == (
        "output.capture",
        {"outputCellId": "cell-view"},
    )
    assert mounted.resolve("selection-1", expected_revision=1) == 2
    lens.close()
