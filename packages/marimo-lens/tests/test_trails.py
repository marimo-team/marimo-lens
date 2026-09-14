from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from marimo._runtime.cell_lifecycle_registry import CellLifecycleRegistry
from marimo_lens import Lens, LensError


@pytest.fixture
def trail_lens(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[Lens, CellLifecycleRegistry, list[dict[str, Any]]]]:
    lens = Lens()
    messages: list[dict[str, Any]] = []
    monkeypatch.setattr(lens, "send", lambda message, **_: messages.append(message))
    registry = CellLifecycleRegistry()
    context = SimpleNamespace(
        graph=SimpleNamespace(cells={"first": object(), "second": object()}),
        cell_lifecycle_registry=registry,
    )
    monkeypatch.setattr("marimo._runtime.context.get_context", lambda: context)
    yield lens, registry, messages
    lens.close()


def test_trail_is_transient_and_does_not_mutate_selections(trail_lens: Any) -> None:
    lens, _, messages = trail_lens
    state = deepcopy(lens.get_state())
    assert (
        lens.reveal(
            [
                {"target": "first", "label": "Question", "message": "Compare demand."},
                {"target": "second", "label": "Answer"},
            ],
            duration_ms=None,
        )
        is None
    )
    assert lens.get_state() == state
    assert messages[-1]["type"] == "attention.reveal"
    assert messages[-1]["payload"]["steps"] == [
        {
            "address": {"kind": "cell", "cellId": "first"},
            "label": "Question",
            "message": "Compare demand.",
        },
        {"address": {"kind": "cell", "cellId": "second"}, "label": "Answer"},
    ]
    assert set(messages[-1]["payload"]) == {"id", "steps"}


def test_new_trail_releases_previous_watch_and_invalidation_is_scoped(
    trail_lens: Any,
) -> None:
    lens, registry, messages = trail_lens
    lens.reveal([{"target": "first", "label": "Question"}], duration_ms=None)
    previous_id = messages[-1]["payload"]["id"]
    lens.reveal([{"target": "second", "label": "Answer"}], duration_ms=None)
    current_id = messages[-1]["payload"]["id"]
    assert current_id != previous_id
    registry.dispose("first", deletion=False)
    assert messages[-1]["type"] == "attention.reveal"
    registry.dispose("second", deletion=True)
    assert messages[-1] == {
        "protocol": "marimo-lens.event",
        "version": 6,
        "type": "attention.trail.stop",
        "payload": {"trailId": current_id},
    }
    assert not any(registry.registry.values())


def test_missing_cell_rejects_the_entire_trail(trail_lens: Any) -> None:
    lens, registry, messages = trail_lens
    with pytest.raises(LensError) as error:
        lens.reveal(
            [
                {"target": "first", "label": "Question"},
                {"target": "missing", "label": "Answer"},
            ],
            duration_ms=None,
        )
    assert error.value.code == "cell_not_found"
    assert not messages
    assert not any(registry.registry.values())


def test_replacement_attention_and_close_release_watches(trail_lens: Any) -> None:
    lens, registry, messages = trail_lens
    lens.reveal([{"target": "first", "label": "Question"}], duration_ms=None)
    lens.start_activity("second", duration_ms=1000)
    assert not any(registry.registry.values())
    assert messages[-1]["type"] == "attention.activity.start"
    lens.reveal([{"target": "first", "label": "Question"}], duration_ms=None)
    lens.close()
    assert not any(registry.registry.values())
    with pytest.raises(LensError, match="closed"):
        lens.reveal([{"target": "first", "label": "Question"}], duration_ms=None)


@pytest.mark.parametrize("target", ["first", [{"target": "first"}]])
def test_single_and_sequence_reveals_share_the_same_held_contract(
    trail_lens: Any, target: Any
) -> None:
    lens, registry, messages = trail_lens
    lens.reveal(target, duration_ms=None)
    assert messages[-1]["payload"]["steps"] == [
        {"address": {"kind": "cell", "cellId": "first"}}
    ]
    assert "durationMs" not in messages[-1]["payload"]
    registry.dispose("first", deletion=False)
    assert messages[-1]["type"] == "attention.trail.stop"


@pytest.mark.parametrize(
    "steps, kwargs, error",
    [
        ([], {}, ValueError),
        ([{"target": "first"}] * 17, {}, ValueError),
        ([{"target": "first"}], {"label": "Ambiguous"}, TypeError),
        (
            [{"target": "first"}, {"target": "second", "message": "x" * 1001}],
            {},
            ValueError,
        ),
        ([{"target": "first", "unexpected": True}], {}, TypeError),
        (["first"], {}, TypeError),
    ],
)
def test_invalid_reveal_steps_preserve_current_attention(
    trail_lens: Any, steps: Any, kwargs: Any, error: type[Exception]
) -> None:
    lens, registry, messages = trail_lens
    lens.reveal("first", duration_ms=None)
    current_id = messages[-1]["payload"]["id"]
    with pytest.raises(error):
        lens.reveal(steps, duration_ms=None, **kwargs)
    assert len(messages) == 1
    registry.dispose("first", deletion=False)
    assert messages[-1]["payload"] == {"trailId": current_id}
