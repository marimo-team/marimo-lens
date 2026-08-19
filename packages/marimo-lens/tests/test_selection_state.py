from __future__ import annotations

import json
from typing import Any, cast

import marimo_lens._selection_state as selection_state_module
import pytest
from marimo_lens._protocol import ProtocolError
from marimo_lens._selection_state import (
    SelectionRecord,
    SelectionState,
    SelectionStore,
    activate_selection,
    apply_selection_put,
    clear_history,
    plan_selection_put,
    reopen_selection,
    resolve_selections,
    validate_state_admission,
)

from tests.support.factories import selection


def test_selection_store_preserves_publish_error_when_rollback_publish_fails() -> None:
    store = SelectionStore()
    previous = store.state

    def publish(_payload: dict[str, Any]) -> None:
        raise RuntimeError("state publish failed")

    with pytest.raises(RuntimeError, match="state publish failed") as raised:
        store.commit(SelectionState(revision=1), publish)

    assert store.state == previous
    assert getattr(raised.value, "__notes__", None) == [
        "Lens restored local selection state but could not republish it."
    ]


@pytest.mark.parametrize(
    "selected",
    [
        selection(selection_id="   "),
        selection(target={"kind": "notebook", "cellIds": ["\t"]}),
    ],
)
def test_selection_state_rejects_whitespace_only_identifiers(
    selected: dict[str, Any],
) -> None:
    with pytest.raises(RuntimeError, match="Selection record is invalid"):
        _state_with_records(
            SelectionRecord(
                selection=selected,
                image=None,
            )
        )


def test_selection_state_requires_allocated_labels() -> None:
    record = SelectionRecord(
        selection=selection(label="S9"),
        image=None,
    )

    with pytest.raises(RuntimeError, match="next selection label"):
        SelectionState(
            revision=1,
            next_label=1,
            current_selection_id=record.id,
            activation_order=(record.id,),
            records=(record,),
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("revision", False, "revision must be a non-negative integer"),
        ("revision", 1.5, "revision must be a non-negative integer"),
        ("next_label", True, "next selection label must be a positive integer"),
        ("next_label", 1.5, "next selection label must be a positive integer"),
    ],
)
def test_selection_state_requires_exact_integer_counters(
    field: str,
    value: object,
    message: str,
) -> None:
    values: dict[str, object] = {field: value}

    with pytest.raises(RuntimeError, match=message):
        SelectionState(**cast(Any, values))


def test_selection_state_rejects_unicode_label_digits() -> None:
    record = SelectionRecord(
        selection=selection(label="S١"),
        image=None,
    )

    with pytest.raises(RuntimeError, match="Selection record is invalid"):
        _state_with_records(record)


def test_put_admission_measures_the_complete_synchronized_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SelectionState()
    selected = selection()
    plan = plan_selection_put(
        state,
        {
            "expectedRevision": 0,
            "selection": selected,
            "imageAction": "clear",
        },
    )
    selections_size = _json_size([selected])
    monkeypatch.setattr(
        selection_state_module,
        "MAX_SELECTION_STATE_BYTES",
        selections_size,
    )

    with pytest.raises(ProtocolError, match="shared .*byte limit") as raised:
        apply_selection_put(
            state,
            plan,
            None,
        )

    assert raised.value.code == "selection_context_limit"
    assert state == SelectionState()


def test_activation_admission_measures_the_new_current_identifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    short = SelectionRecord(
        selection=selection(selection_id="s", label="S1"),
        image=None,
    )
    long_id = "selection-" + "x" * 118
    long = SelectionRecord(
        selection=selection(selection_id=long_id, label="S2"),
        image=None,
    )
    state = SelectionState(
        revision=1,
        next_label=3,
        current_selection_id=short.id,
        activation_order=(long.id, short.id),
        records=(short, long),
    )
    monkeypatch.setattr(
        selection_state_module,
        "MAX_SELECTION_STATE_BYTES",
        _json_size(state.payload()),
    )
    validate_state_admission(state)

    with pytest.raises(ProtocolError, match="shared .*byte limit") as raised:
        activate_selection(state, long.id, expected_revision=1)

    assert raised.value.code == "selection_context_limit"
    assert state.current_selection_id == short.id


def test_resolve_reopen_and_clear_history_preserve_selection_identity() -> None:
    selected = selection(note="Please align this label.")
    state = _state_with_records(SelectionRecord(selection=selected, image=None))

    addressed_state, removed, receipts = resolve_selections(
        state,
        [selected["id"]],
        expected_revision=1,
        addressed_at="2026-07-23T08:00:00Z",
        summary="Aligned the label and verified the rendered output.",
    )

    assert removed[0].detached_selection() == selected
    assert addressed_state.records == ()
    assert addressed_state.current_selection_id is None
    assert addressed_state.history == receipts
    receipt = receipts[0]
    assert receipt.detached_receipt()["resolutionRevision"] == 2

    reopened_state, reopened = reopen_selection(
        addressed_state,
        selected["id"],
        receipt.resolution_revision,
        expected_revision=2,
    )

    assert reopened_state.revision == 3
    assert reopened_state.current_selection_id == selected["id"]
    assert reopened_state.next_label == 2
    assert reopened_state.history == addressed_state.history
    assert reopened["label"] == selected["label"]
    assert reopened["note"] == selected["note"]
    assert reopened["target"] == selected["target"]
    assert reopened["anchor"] == selected["anchor"]
    assert reopened["snapshot"] == {"status": "pending"}
    assert reopened["previousResolution"] == {
        "addressedAt": "2026-07-23T08:00:00Z",
        "summary": "Aligned the label and verified the rendered output.",
    }

    cleared = clear_history(reopened_state, expected_revision=3)
    assert cleared.revision == 4
    assert cleared.history == ()
    assert "previousResolution" not in cleared.selections()[0]
    assert {
        key: value
        for key, value in cleared.selections()[0].items()
        if key != "previousResolution"
    } == {key: value for key, value in reopened.items() if key != "previousResolution"}
    assert cleared.current_selection_id == selected["id"]


def test_resolve_selections_commits_one_ordered_batch() -> None:
    records = tuple(
        SelectionRecord(
            selection=selection(
                selection_id=f"selection-{index}",
                label=f"S{index}",
            ),
            image=None,
        )
        for index in range(1, 4)
    )
    state = _state_with_records(*records)

    addressed, removed, receipts = resolve_selections(
        state,
        ["selection-3", "selection-1"],
        expected_revision=1,
        addressed_at="2026-07-23T08:00:00Z",
        summary="Updated and verified both requests.",
    )

    assert addressed.revision == 2
    assert [record.id for record in addressed.records] == ["selection-2"]
    assert addressed.current_selection_id == "selection-2"
    assert [record.id for record in removed] == ["selection-3", "selection-1"]
    assert [record.selection_id for record in receipts] == [
        "selection-3",
        "selection-1",
    ]
    assert {record.resolution_revision for record in receipts} == {2}
    assert addressed.history == receipts


@pytest.mark.parametrize(
    ("selection_ids", "code"),
    [
        ([], "invalid_selection"),
        (["selection-1", "selection-1"], "invalid_selection"),
        (["selection-missing"], "selection_not_found"),
    ],
)
def test_resolve_selections_rejects_the_complete_invalid_batch(
    selection_ids: list[str],
    code: str,
) -> None:
    state = _state_with_records(
        SelectionRecord(selection=selection(), image=None),
    )

    with pytest.raises(ProtocolError) as raised:
        resolve_selections(
            state,
            selection_ids,
            expected_revision=1,
            addressed_at="2026-07-23T08:00:00Z",
            summary=None,
        )

    assert raised.value.code == code
    assert state.records[0].id == "selection-1"
    assert state.history == ()


def test_addressed_history_keeps_the_most_recent_receipts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(selection_state_module, "MAX_HISTORY", 2)
    selected = selection()
    state = _state_with_records(SelectionRecord(selection=selected, image=None))

    for index in range(3):
        state, _, receipts = resolve_selections(
            state,
            [selected["id"]],
            expected_revision=state.revision,
            addressed_at=f"2026-07-23T08:0{index}:00Z",
            summary=f"Completed pass {index + 1}.",
        )
        receipt = receipts[0]
        if index < 2:
            state, _ = reopen_selection(
                state,
                selected["id"],
                receipt.resolution_revision,
                expected_revision=state.revision,
            )

    assert [record.resolution_revision for record in state.history] == [4, 6]
    assert [record.receipt["summary"] for record in state.history] == [
        "Completed pass 2.",
        "Completed pass 3.",
    ]


def test_reopen_requires_an_exact_inactive_history_receipt() -> None:
    selected = selection()
    state = _state_with_records(SelectionRecord(selection=selected, image=None))

    with pytest.raises(ProtocolError, match="already open") as active:
        reopen_selection(
            state,
            selected["id"],
            1,
            expected_revision=1,
        )
    assert active.value.code == "selection_already_open"

    addressed, _, _ = resolve_selections(
        state,
        [selected["id"]],
        expected_revision=1,
        addressed_at="2026-07-23T08:00:00Z",
        summary=None,
    )
    with pytest.raises(ProtocolError, match="no longer in history") as missing:
        reopen_selection(
            addressed,
            selected["id"],
            99,
            expected_revision=2,
        )
    assert missing.value.code == "history_not_found"


def _state_with_records(*records: SelectionRecord) -> SelectionState:
    ids = tuple(record.id for record in records)
    return SelectionState(
        revision=1,
        next_label=len(records) + 1,
        current_selection_id=ids[-1],
        activation_order=ids,
        records=records,
    )


def _json_size(value: object) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
