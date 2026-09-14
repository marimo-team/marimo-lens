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
        lens.show_trail(
            [
                {"cell_id": "first", "label": "Question", "message": "Compare demand."},
                {"cell_id": "second", "label": "Answer"},
            ]
        )
        is None
    )
    assert lens.get_state() == state
    assert messages[-1]["type"] == "attention.trail"
    assert messages[-1]["payload"]["steps"] == [
        {"cellId": "first", "label": "Question", "message": "Compare demand."},
        {"cellId": "second", "label": "Answer"},
    ]
    assert set(messages[-1]["payload"]) == {"id", "steps"}


def test_new_trail_releases_previous_watch_and_invalidation_is_scoped(
    trail_lens: Any,
) -> None:
    lens, registry, messages = trail_lens
    lens.show_trail([{"cell_id": "first", "label": "Question"}])
    previous_id = messages[-1]["payload"]["id"]
    lens.show_trail([{"cell_id": "second", "label": "Answer"}])
    current_id = messages[-1]["payload"]["id"]
    assert current_id != previous_id
    registry.dispose("first", deletion=False)
    assert messages[-1]["type"] == "attention.trail"
    registry.dispose("second", deletion=True)
    assert messages[-1] == {
        "protocol": "marimo-lens.event",
        "version": 6,
        "type": "attention.trail.stop",
        "payload": {"trailId": current_id},
    }
    assert not any(registry.registry.values())


@pytest.mark.parametrize(
    "steps",
    [[], [{"cell_id": "first", "label": "Question"}] * 17],
)
def test_invalid_step_count_is_rejected_before_publication(
    trail_lens: Any, steps: Any
) -> None:
    lens, registry, messages = trail_lens
    with pytest.raises(ValueError):
        lens.show_trail(steps)
    assert not messages
    assert not any(registry.registry.values())


def test_missing_cell_rejects_the_entire_trail(trail_lens: Any) -> None:
    lens, registry, messages = trail_lens
    with pytest.raises(LensError) as error:
        lens.show_trail(
            [
                {"cell_id": "first", "label": "Question"},
                {"cell_id": "missing", "label": "Answer"},
            ]
        )
    assert error.value.code == "cell_not_found"
    assert not messages
    assert not any(registry.registry.values())


def test_replacement_attention_and_close_release_watches(trail_lens: Any) -> None:
    lens, registry, messages = trail_lens
    lens.show_trail([{"cell_id": "first", "label": "Question"}])
    lens.reveal("second", duration_ms=1000)
    assert not any(registry.registry.values())
    assert messages[-1]["type"] == "attention.reveal"
    lens.show_trail([{"cell_id": "first", "label": "Question"}])
    lens.close()
    assert not any(registry.registry.values())
    with pytest.raises(LensError, match="closed"):
        lens.show_trail([{"cell_id": "first", "label": "Question"}])
