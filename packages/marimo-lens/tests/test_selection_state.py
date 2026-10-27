from __future__ import annotations

import json
import threading
from typing import Any

import marimo_lens._selection.state as selection_state_module
import pytest
from marimo_lens._core.errors import Rejection
from marimo_lens._schema.model import dump_model
from marimo_lens._schema.selection import Selection, SelectionInput
from marimo_lens._selection.state import (
    SelectionRecord,
    SelectionState,
    activate_selection,
    clear_history,
    put_selection,
    reopen_selection,
    resolve_selections,
    validate_state_admission,
)
from marimo_lens._session.session import LensSession
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
    one = _state_with_records(_record(selection()))
    cases = [
        (full, new, 0, "revision_conflict"),
        (full, new, 1, "selection_limit_reached"),
        (one, new, 1, "selection_label_conflict"),
        (one, {**new, "label": "S2"}, 1, "selection_not_found"),
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


def test_put_admission_measures_the_complete_synchronized_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SelectionState()
    selected = selection()
    monkeypatch.setattr(
        selection_state_module,
        "MAX_SELECTION_STATE_BYTES",
        _json_size([selected]),
    )

    with pytest.raises(Rejection, match="shared .*byte limit") as raised:
        put_selection(
            state,
            SelectionInput.model_validate(selected),
            image_action="clear",
            expected_revision=0,
            image=None,
        )

    assert raised.value.code == "selection_context_limit"
    assert state == SelectionState()


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


def test_resolve_reopen_and_clear_history_preserve_selection_identity() -> None:
    selected = selection(note="Please align this label.")
    state = _state_with_records(_record(selected))

    resolved_state, removed = resolve_selections(
        state,
        [selected["id"]],
        expected_revision=1,
        resolved_at="2026-07-23T08:00:00Z",
        summary="Aligned the label and verified the rendered output.",
    )
    receipt = resolved_state.history[0]
    reopened_state = reopen_selection(
        resolved_state,
        selected["id"],
        receipt.resolution_revision,
        expected_revision=2,
    )
    record = reopened_state.record(selected["id"])
    assert record is not None
    reopened = record.payload

    assert removed[0].payload == selected
    assert resolved_state.records == ()
    assert resolved_state.current_selection_id is None
    assert dump_model(receipt)["resolutionRevision"] == 2
    assert reopened_state.revision == 3
    assert reopened_state.current_selection_id == selected["id"]
    assert reopened_state.next_label == 2
    assert reopened_state.history == resolved_state.history
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
    state = _state_with_records(
        *(
            _record(selection(selection_id=f"selection-{index}", label=f"S{index}"))
            for index in range(1, 4)
        )
    )

    resolved, removed = resolve_selections(
        state,
        ["selection-3", "selection-1"],
        expected_revision=1,
        resolved_at="2026-07-23T08:00:00Z",
        summary="Updated and verified both requests.",
    )

    assert resolved.revision == 2
    assert [record.id for record in resolved.records] == ["selection-2"]
    assert resolved.current_selection_id == "selection-2"
    assert [record.id for record in removed] == ["selection-3", "selection-1"]
    assert [receipt.selection_id for receipt in resolved.history] == [
        "selection-3",
        "selection-1",
    ]
    assert {receipt.resolution_revision for receipt in resolved.history} == {2}


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
    state = _state_with_records(_record(selection()))

    with pytest.raises(Rejection) as raised:
        resolve_selections(
            state,
            selection_ids,
            expected_revision=1,
            resolved_at="2026-07-23T08:00:00Z",
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
    state = _state_with_records(_record(selected))

    for index in range(3):
        state, _ = resolve_selections(
            state,
            [selected["id"]],
            expected_revision=state.revision,
            resolved_at=f"2026-07-23T08:0{index}:00Z",
            summary=f"Completed pass {index + 1}.",
        )
        if index < 2:
            state = reopen_selection(
                state,
                selected["id"],
                state.history[-1].resolution_revision,
                expected_revision=state.revision,
            )

    assert [receipt.resolution_revision for receipt in state.history] == [4, 6]
    assert [receipt.summary for receipt in state.history] == [
        "Completed pass 2.",
        "Completed pass 3.",
    ]


def test_reopen_requires_an_exact_inactive_history_receipt() -> None:
    selected = selection()
    state = _state_with_records(_record(selected))

    with pytest.raises(Rejection, match="already open") as active:
        reopen_selection(state, selected["id"], 1, expected_revision=1)
    assert active.value.code == "selection_already_open"

    resolved, _ = resolve_selections(
        state,
        [selected["id"]],
        expected_revision=1,
        resolved_at="2026-07-23T08:00:00Z",
        summary=None,
    )
    with pytest.raises(Rejection, match="no longer in history") as missing:
        reopen_selection(resolved, selected["id"], 99, expected_revision=2)
    assert missing.value.code == "history_not_found"


def test_session_keeps_the_publish_error_when_republishing_fails() -> None:
    def publish(_payload: dict[str, Any]) -> None:
        raise RuntimeError("state publish failed")

    session = LensSession(_NoNotebook(), lock=threading.RLock(), publish=publish)
    previous = session.state

    with pytest.raises(RuntimeError, match="state publish failed") as raised:
        session.clear_selections(expected_revision=0)

    assert session.state == previous
    assert getattr(raised.value, "__notes__", None) == [
        "Lens restored local selection state but could not republish it."
    ]


class _NoNotebook:
    def snapshot(self, output_cell_ids: Any) -> Any:
        raise AssertionError("The session read the notebook.")

    def cell_status(self, cell_id: str) -> Any:
        raise AssertionError("The session read the notebook.")


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
