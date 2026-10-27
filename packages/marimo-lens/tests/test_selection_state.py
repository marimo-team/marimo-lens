from __future__ import annotations

import json
from typing import Any

import marimo_lens._selection.state as selection_state_module
import pytest
from marimo_lens._core.errors import Rejection
from marimo_lens._schema.selection import Selection, SelectionInput
from marimo_lens._selection.state import (
    SelectionRecord,
    SelectionState,
    activate_selection,
    put_selection,
    reopen_selection,
    resolve_selections,
    validate_state_admission,
)
from pydantic import ValidationError

from tests.support.factories import selection


def test_selections_reject_unicode_label_digits() -> None:
    with pytest.raises(ValidationError):
        Selection.model_validate(selection(label="S١"))


def test_put_refuses_with_the_first_failing_check() -> None:
    full = _state_with_records(
        *(
            _record(selection(selection_id=f"selection-{index}", label=f"S{index}"))
            for index in range(1, 65)
        )
    )
    new = selection(selection_id="selection-new", label="S1")
    moved = {**selection(), "anchor": {"kind": "point", "x": 0.5, "y": 0.5}}
    cases = [
        (full, new, 0, "revision_conflict"),
        (full, new, 1, "selection_limit_reached"),
        (_state_with_records(_record(selection())), new, 1, "selection_not_found"),
        (full, {**moved, "label": "S9"}, 1, "selection_identity_changed"),
        (full, moved, 1, "selection_capture_changed"),
    ]

    codes = []
    for state, selected, revision, _code in cases:
        with pytest.raises(Rejection) as raised:
            put_selection(
                state,
                SelectionInput.model_validate(selected),
                image_action="preserve",
                expected_revision=revision,
                image=None,
            )
        codes.append(raised.value.code)

    assert codes == [code for *_case, code in cases]


def test_activation_admission_measures_the_new_current_identifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    short = _record(selection(selection_id="s", label="S1"))
    long_id = "selection-" + "x" * 118
    long = _record(selection(selection_id=long_id, label="S2"))
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

    with pytest.raises(Rejection, match="shared .*byte limit") as raised:
        activate_selection(state, long.id, expected_revision=1)

    assert raised.value.code == "selection_context_limit"
    assert state.current_selection_id == short.id


def test_resolve_closes_selections_and_reopen_admits_a_recorded_one() -> None:
    selected = selection(note="Please align this label.")
    state = _state_with_records(_record(selected))

    resolved_state, removed = resolve_selections(state, [selected["id"]])
    reopened_state = reopen_selection(
        resolved_state,
        Selection.model_validate(
            {
                **selected,
                "snapshot": {"status": "pending"},
                "previousResolution": {
                    "resolvedAt": "2026-07-23T08:00:00Z",
                    "summary": "Aligned the label.",
                },
            }
        ),
        expected_revision=2,
    )
    record = reopened_state.record(selected["id"])
    assert record is not None
    reopened = record.payload

    assert removed[0].payload == selected
    assert resolved_state.records == ()
    assert resolved_state.current_selection_id is None
    assert reopened_state.revision == 3
    assert reopened_state.current_selection_id == selected["id"]
    assert reopened["label"] == selected["label"]
    assert reopened["target"] == selected["target"]
    assert reopened["snapshot"] == {"status": "pending"}
    assert reopened["previousResolution"] == {
        "resolvedAt": "2026-07-23T08:00:00Z",
        "summary": "Aligned the label.",
    }


def test_reopen_rejects_an_open_selection_or_a_label_in_use() -> None:
    selected = selection()
    state = _state_with_records(_record(selected))

    with pytest.raises(Rejection, match="already open") as active:
        reopen_selection(state, Selection.model_validate(selected), expected_revision=1)
    with pytest.raises(Rejection, match="already uses the label S1") as label:
        reopen_selection(
            state,
            Selection.model_validate({**selected, "id": "selection-older"}),
            expected_revision=1,
        )

    assert active.value.code == "selection_already_open"
    assert label.value.code == "selection_label_conflict"


def test_reopening_a_later_label_moves_the_next_label_past_it() -> None:
    state = SelectionState(revision=1)

    reopened = reopen_selection(
        state,
        Selection.model_validate(selection(label="S7", snapshot={"status": "pending"})),
        expected_revision=1,
    )

    assert reopened.next_label == 8


def _record(selected: dict[str, Any]) -> SelectionRecord:
    return SelectionRecord(selection=Selection.model_validate(selected), image=None)


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
