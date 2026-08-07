from __future__ import annotations

import inspect
from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import cast

import pytest
from marimo_lens import Lens, LensContext, LensError, agent

from tests.support.factories import png


class _MarimoWrapper:
    __module__ = "marimo.fake"

    def __init__(self, widget: Lens) -> None:
        self.widget = widget


def test_agent_module_exports_the_handoff_surface() -> None:
    assert set(agent.__all__) == {"MountedLens", "connect"}


def test_agent_handoff_matches_documented_signatures() -> None:
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


def _context(
    lens: Lens,
    *,
    aliases: dict[str, object] | None = None,
) -> SimpleNamespace:
    namespace = {"_cell_demo_lens": lens, **(aliases or {})}
    return SimpleNamespace(globals=namespace)


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


def test_connect_deduplicates_aliases_and_preserves_identity() -> None:
    lens = Lens()
    context = _context(
        lens,
        aliases={"alias": lens, "wrapped": _MarimoWrapper(lens)},
    )

    first = agent.connect(context)
    second = agent.connect(context, identity=first.identity)

    assert second.identity == first.identity
    with pytest.raises(LensError) as raised:
        agent.connect(context, identity="another-lens")
    assert raised.value.code == "lens_unavailable"
    assert raised.value.revision is None
    lens.close()


def test_connected_handle_keeps_its_identity_and_lens_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lens = Lens()
    replacement = Lens()
    mounted = agent.connect(_context(lens))
    identity = mounted.identity
    expected_context = _lens_context(revision=4)
    replacement_context = _lens_context(revision=9)

    def context(target: Lens) -> LensContext:
        if target is lens:
            return expected_context
        return replacement_context

    monkeypatch.setattr(Lens, "context", context)

    with pytest.raises(AttributeError):
        mounted.__setattr__("_identity", "another-lens")
    with pytest.raises(AttributeError):
        mounted.__setattr__("_lens", replacement)

    assert mounted.identity == identity
    assert mounted.context().revision == expected_context.revision
    lens.close()
    replacement.close()


def test_connect_reports_an_unavailable_lens() -> None:
    lens = Lens()
    lens.close()

    with pytest.raises(LensError) as raised:
        agent.connect(_context(lens))
    assert raised.value.code == "lens_unavailable"
    assert raised.value.revision is None


def test_connect_reports_ambiguous_lenses() -> None:
    first = Lens()
    second = Lens()
    context = _context(first, aliases={"other_lens": second})

    with pytest.raises(LensError) as raised:
        agent.connect(context)

    assert raised.value.code == "lens_ambiguous"
    assert raised.value.revision is None
    first.close()
    second.close()


def test_connect_requires_a_string_identity() -> None:
    lens = Lens()
    with pytest.raises(TypeError, match="identity must be a string or None"):
        agent.connect(_context(lens), identity=cast(str | None, 1))
    lens.close()


def test_connect_requires_a_nonempty_identity() -> None:
    lens = Lens()
    with pytest.raises(ValueError, match="identity must not be empty"):
        agent.connect(_context(lens), identity="")
    lens.close()


def test_context_returns_the_current_snapshot_and_png_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png()
    lens = Lens()
    context_value = _lens_context(images={"selection-1": data})
    monkeypatch.setattr(Lens, "context", lambda _self: context_value)
    mounted = agent.connect(_context(lens))

    assert mounted.context().revision == 4
    assert mounted.context().images["selection-1"] == data
    lens.close()


def test_cell_image_forwards_the_raw_byte_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = png(3, 2)
    lens = Lens()
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
    mounted = agent.connect(_context(lens))

    result = mounted.cell_image("cell-view", expected_revision=4)

    assert result == data
    assert calls == [("cell-view", 4)]
    lens.close()


def test_mounted_lens_forwards_attention_workflow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    lens = Lens()

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
    mounted = agent.connect(_context(lens))

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
    lens = Lens()

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
    mounted = agent.connect(_context(lens))

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
