from __future__ import annotations

import inspect
import subprocess
import sys
from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import cast

import pytest
from marimo_lens import Lens, LensContext, LensError, agent

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
    assert set(agent.__all__) == {"MountedLens", "add_lens_cell", "connect"}


def test_package_import_exposes_agent_help() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import marimo_lens\nhelp(marimo_lens.agent)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "marimo_lens.agent" in result.stdout


def test_agent_handoff_matches_documented_signatures() -> None:
    assert list(inspect.signature(agent.add_lens_cell).parameters) == ["ctx"]
    assert list(inspect.signature(agent.connect).parameters) == ["identity"]
    assert (
        inspect.signature(agent.connect).parameters["identity"].kind
        is inspect.Parameter.KEYWORD_ONLY
    )
    expected_parameters = {
        "context": ["self"],
        "cell_image": ["self", "cell_id", "expected_revision"],
        "start_activity": [
            "self",
            "cell_id",
            "duration_ms",
            "label",
            "message",
        ],
        "stop_activity": ["self", "cell_id"],
        "resolve": ["self", "selection_ids", "expected_revision", "summary"],
        "reveal": ["self", "cell_id", "duration_ms", "label", "message"],
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
            "version": 2,
            "type": f"output.capture.{'ready' if mounted else 'unready'}",
            "payload": {},
        },
        [],
    )


def _mounted_lens() -> Lens:
    lens = Lens()
    _set_mounted(lens)
    return lens


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
                    "outputCellId": "cell-view",
                    "cellStatus": "available",
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


def test_connect_tracks_the_browser_mount_lifecycle() -> None:
    lens = Lens()

    with pytest.raises(LensError) as raised:
        agent.connect()

    assert raised.value.code == "lens_unavailable"

    _set_mounted(lens)
    _set_mounted(lens)
    identity = agent.connect().identity

    _set_mounted(lens, mounted=False)
    assert agent.connect().identity == identity

    _set_mounted(lens, mounted=False)
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

    first.close()
    second.close()


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

    def start_activity(
        _self: Lens,
        cell_id: str,
        *,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        calls.append(("start", cell_id, duration_ms, label, message))

    def stop_activity(_self: Lens, cell_id: str) -> None:
        calls.append(("stop", cell_id))

    def reveal(
        _self: Lens,
        cell_id: str,
        *,
        duration_ms: int,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        calls.append(("reveal", cell_id, duration_ms, label, message))

    monkeypatch.setattr(Lens, "start_activity", start_activity)
    monkeypatch.setattr(Lens, "stop_activity", stop_activity)
    monkeypatch.setattr(Lens, "reveal", reveal)
    mounted = agent.connect()

    mounted.start_activity(
        "cell-view",
        label="Updating aggregation",
        message="Applying the requested grouping.",
    )
    mounted.stop_activity("cell-view")
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
            "Updating aggregation",
            "Applying the requested grouping.",
        ),
        ("stop", "cell-view"),
        (
            "reveal",
            "cell-view",
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
