from __future__ import annotations

import copy
import hashlib
import inspect
import json
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any, cast

import pytest
from marimo_lens import (
    ActivityHandle,
    Lens,
    LensError,
    RevealStep,
    SelectionReference,
)
from marimo_lens._marimo.adapter import MarimoRuntimeAdapter
from marimo_lens._protocol.messages import PROTOCOL_VERSION

from tests.support.browser import BrowserLens
from tests.support.factories import cell, png, selection, snapshot, snapshot_metadata


class FailingPublishLens(BrowserLens):
    fail_next_state_publish = False

    def set_trait(self, name: str, value: Any) -> None:
        if name == "_state" and self.fail_next_state_publish:
            self.fail_next_state_publish = False
            raise RuntimeError("state publish failed")
        super().set_trait(name, value)


class FailingEventLens(BrowserLens):
    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        if content.get("protocol") == "marimo-lens.event":
            raise RuntimeError("browser disconnected")
        super().send(content, buffers)


class DelayedEventLens(BrowserLens):
    def __init__(self) -> None:
        self.first_event_started = threading.Event()
        self.second_resolution_finished = threading.Event()
        super().__init__()

    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        if (
            content.get("protocol") == "marimo-lens.event"
            and content.get("revision") == 3
        ):
            self.first_event_started.set()
            self.second_resolution_finished.wait(timeout=0.5)
        super().send(content, buffers)


@pytest.fixture
def runtime_reads(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Report every cell as available and list the cells Lens asked about."""

    reads: list[str] = []

    def cell_status(_self: object, cell_id: str) -> str:
        reads.append(cell_id)
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", cell_status)
    return reads


def _attend(
    lens: Lens, action: str, *, target: Any = "cell-view", **arguments: Any
) -> object:
    if action == "reveal":
        arguments.setdefault("duration_ms", 4_000)
    return getattr(lens, action)(target, **arguments)


def test_public_api_exposes_context_and_resolution_contracts() -> None:
    lens_parameters = inspect.signature(Lens).parameters
    assert list(lens_parameters) == ["dom_selector"]
    assert lens_parameters["dom_selector"].kind is inspect.Parameter.KEYWORD_ONLY
    assert lens_parameters["dom_selector"].default is None
    resolve_parameters = inspect.signature(Lens.resolve).parameters
    assert list(resolve_parameters) == [
        "self",
        "selection_ids",
        "expected_revision",
        "summary",
    ]
    assert (
        resolve_parameters["expected_revision"].kind is inspect.Parameter.KEYWORD_ONLY
    )
    assert resolve_parameters["summary"].default is None
    for method in (Lens.reveal, Lens.start_activity):
        parameters = inspect.signature(method).parameters
        assert list(parameters) == [
            "self",
            "target",
            "expected_revision",
            "duration_ms",
            "label",
            "message",
        ]
        for name in ("expected_revision", "duration_ms", "label", "message"):
            assert parameters[name].kind is inspect.Parameter.KEYWORD_ONLY
        for name in ("label", "message"):
            assert parameters[name].default is None
    assert (
        inspect.signature(Lens.reveal).parameters["duration_ms"].default
        is inspect.Parameter.empty
    )
    assert (
        inspect.signature(Lens.start_activity).parameters["duration_ms"].default is None
    )
    assert list(inspect.signature(Lens.stop_activity).parameters) == [
        "self",
        "activity",
    ]

    lens = BrowserLens()
    assert not hasattr(lens, "images")
    assert lens.synced_state() == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }


def test_reveal_normalizes_a_bounded_message_without_changing_state_or_context(
    runtime_reads: list[str],
) -> None:
    lens = BrowserLens()
    lens.put(selection())
    before = copy.deepcopy(lens.synced_state())
    before_context = lens.context()
    before_text = before_context.text
    message = "x" * 1_000

    lens.reveal(
        "cell-view",
        label="Updated chart",
        message=f"  {message}  ",
        duration_ms=120_000,
    )

    assert lens.sent[-1] == (
        {
            "protocol": "marimo-lens.event",
            "version": PROTOCOL_VERSION,
            "type": "attention.reveal",
            "payload": {
                "id": lens.sent[-1][0]["payload"]["id"],
                "steps": [
                    {
                        "address": {"kind": "cell", "cellId": "cell-view"},
                        "label": "Updated chart",
                        "message": message,
                    }
                ],
                "durationMs": 120_000,
            },
        },
        [],
    )
    assert lens.synced_state() == before
    context = lens.context()
    assert context.references == {
        **before_context.references,
        "generatedAt": context.references["generatedAt"],
    }
    assert context.text == before_text


def test_reveal_mixes_cells_and_selections_with_one_revision_guard(
    runtime_reads: list[str],
) -> None:
    lens = BrowserLens()
    lens.put(selection())
    context = lens.context()
    reference = context.current
    assert reference is not None
    steps: list[RevealStep] = [
        {"target": "cell-view"},
        {"target": reference, "message": "Checked this."},
    ]
    before = copy.deepcopy(lens.synced_state())
    count = len(lens.sent)
    with pytest.raises(TypeError, match="expected_revision"):
        lens.reveal(steps, duration_ms=None)
    with pytest.raises(LensError) as error:
        lens.reveal(steps, expected_revision=context.revision - 1, duration_ms=None)
    assert error.value.code == "revision_conflict"
    assert len(lens.sent) == count
    lens.reveal(steps, expected_revision=context.revision, duration_ms=None)
    payload = lens.sent[-1][0]["payload"]
    assert payload["steps"] == [
        {"address": {"kind": "cell", "cellId": "cell-view"}},
        {
            "address": {
                "kind": "selection",
                "selectionId": reference["id"],
                "revision": context.revision,
            },
            "message": "Checked this.",
        },
    ]
    assert "durationMs" not in payload
    assert lens.synced_state() == before


def test_reveal_requires_a_duration() -> None:
    lens = BrowserLens()

    with pytest.raises(TypeError):
        cast(Any, lens.reveal)("cell-view")


def test_start_activity_sends_one_transient_event_without_changing_selection_state(
    runtime_reads: list[str],
) -> None:
    lens = BrowserLens()
    lens.put(selection())
    before = copy.deepcopy(lens.synced_state())

    activity = lens.start_activity(
        "cell-view",
        duration_ms=8_000,
        label="  On it  ",
        message="  Updating the aggregation.  ",
    )
    assert activity == lens.sent[-1][0]["payload"]["activityId"]

    assert lens.sent[-1] == (
        {
            "protocol": "marimo-lens.event",
            "version": PROTOCOL_VERSION,
            "type": "attention.activity.start",
            "payload": {
                "activityId": lens.sent[-1][0]["payload"]["activityId"],
                "address": {"kind": "cell", "cellId": "cell-view"},
                "durationMs": 8_000,
                "label": "On it",
                "message": "Updating the aggregation.",
            },
        },
        [],
    )
    assert lens.synced_state() == before
    context = lens.context()
    assert "activity" not in json.dumps(context.references)
    assert "Updating the aggregation" not in context.text


def test_stop_activity_sends_one_matching_owner_event_without_runtime_access(
    runtime_reads: list[str],
) -> None:
    lens = BrowserLens()
    lens.put(selection())
    before = copy.deepcopy(lens.synced_state())

    activity = lens.start_activity("cell-view")
    start_event = lens.sent[-1][0]
    runtime_reads.clear()

    restored_activity = ActivityHandle(json.loads(json.dumps(activity)))
    lens.stop_activity(restored_activity)

    assert set(start_event["payload"]) == {"activityId", "address"}
    assert lens.sent[-1] == (
        {
            "protocol": "marimo-lens.event",
            "version": PROTOCOL_VERSION,
            "type": "attention.activity.stop",
            "payload": {"activityId": start_event["payload"]["activityId"]},
        },
        [],
    )
    assert lens.synced_state() == before
    assert runtime_reads == []


def test_selection_attention_uses_stored_identity_and_revision(
    runtime_reads: list[str],
) -> None:
    lens = BrowserLens()
    lens.put(
        selection(
            target={
                "kind": "dom",
                "sources": [],
                "cellIds": [],
                "documentId": "document-1",
                "documentPath": "/dashboard/",
                "domSelector": "#summary",
            }
        )
    )
    context = lens.context()
    reference = context.current
    assert reference is not None
    before = copy.deepcopy(lens.synced_state())

    activity = lens.start_activity(
        reference,
        expected_revision=context.revision,
        message="Applying the requested change.",
    )
    lens.reveal(
        reference,
        expected_revision=context.revision,
        duration_ms=4_000,
        message="Verified the selected target.",
    )
    lens.stop_activity(activity)

    address = {
        "kind": "selection",
        "selectionId": reference["id"],
        "revision": context.revision,
    }
    assert [message[0]["type"] for message in lens.sent[-3:]] == [
        "attention.activity.start",
        "attention.reveal",
        "attention.activity.stop",
    ]
    assert lens.sent[-3][0]["payload"]["address"] == address
    assert lens.sent[-2][0]["payload"]["steps"][0]["address"] == address
    assert "domSelector" not in lens.sent[-3][0]["payload"]
    assert lens.synced_state() == before
    assert runtime_reads == []


@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_selection_attention_rejects_a_stale_revision(action: str) -> None:
    lens = BrowserLens()
    lens.put(selection())
    reference = lens.context().current
    assert reference is not None
    sent_before = len(lens.sent)

    with pytest.raises(LensError) as raised:
        _attend(lens, action, target=reference, expected_revision=0)

    assert raised.value.code == "revision_conflict"
    assert raised.value.revision == 1
    assert len(lens.sent) == sent_before


def test_selection_attention_rejects_a_missing_selection() -> None:
    lens = BrowserLens()
    missing = cast(SelectionReference, {"id": "selection-missing"})

    with pytest.raises(LensError) as raised:
        lens.start_activity(missing, expected_revision=0)

    assert raised.value.code == "selection_not_found"
    assert raised.value.revision == 0


@pytest.mark.parametrize(
    ("activity", "error"),
    [(1, TypeError), ("", ValueError)],
)
def test_stop_activity_validates_the_handle(
    activity: object,
    error: type[Exception],
) -> None:
    lens = BrowserLens()

    with pytest.raises(error):
        lens.stop_activity(cast(ActivityHandle, activity))

    assert lens.sent == []


@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_tolerates_delivery_failure(
    runtime_reads: list[str], action: str
) -> None:
    lens = FailingEventLens()

    result = _attend(lens, action)

    if action == "reveal":
        assert result is None
    else:
        assert isinstance(result, str)
    assert lens.revision == 0


@pytest.mark.parametrize(
    ("status", "code"),
    [
        ("missing", "cell_not_found"),
        ("unavailable", "runtime_unavailable"),
    ],
)
@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_requires_an_exact_runtime_cell(
    monkeypatch: pytest.MonkeyPatch,
    status: str,
    code: str,
    action: str,
) -> None:
    monkeypatch.setattr(
        MarimoRuntimeAdapter, "cell_status", lambda _self, _cell_id: status
    )
    lens = BrowserLens()

    with pytest.raises(LensError) as raised:
        _attend(lens, action)

    assert raised.value.code == code
    assert raised.value.revision == 0
    assert lens.sent == []


@pytest.mark.parametrize(
    ("action", "arguments", "error", "bound"),
    [
        ("reveal", {"target": 1}, TypeError, None),
        ("start_activity", {"target": ""}, ValueError, None),
        ("reveal", {"target": "x" * 129}, ValueError, "at most 128 "),
        ("start_activity", {"message": 1}, TypeError, None),
        ("start_activity", {"target": "\ud800"}, ValueError, "valid Unicode text"),
        ("reveal", {"message": "\ud800"}, ValueError, "valid Unicode text"),
        ("start_activity", {"message": "\U0001f642" * 121}, ValueError, "at most 240 "),
        ("reveal", {"message": "x" * 1_001}, ValueError, "at most 1000 "),
        ("start_activity", {"label": 1}, TypeError, None),
        ("start_activity", {"label": "x" * 41}, ValueError, "at most 40 "),
        ("reveal", {"label": "\U0001f642" * 21}, ValueError, "at most 40 "),
        ("reveal", {"duration_ms": True}, TypeError, None),
        ("reveal", {"duration_ms": 0}, ValueError, "300000"),
        ("start_activity", {"duration_ms": 300_001}, ValueError, "300000"),
    ],
)
def test_target_attention_validates_arguments_before_runtime_access(
    runtime_reads: list[str],
    action: str,
    arguments: dict[str, Any],
    error: type[Exception],
    bound: str | None,
) -> None:
    lens = BrowserLens()

    with pytest.raises(error, match=bound):
        _attend(lens, action, **arguments)

    assert runtime_reads == []
    assert lens.sent == []


@pytest.mark.parametrize(
    ("arguments", "error", "message"),
    [
        ({"target": 1}, TypeError, "target must be a cell ID or SelectionReference"),
        ({"target": ""}, ValueError, "cell_id must not be empty"),
        ({"target": "x" * 129}, ValueError, "at most 128 UTF-16 code units"),
        ({"message": 1}, TypeError, "message must be a string or None"),
        ({"message": "\ud800"}, ValueError, "valid Unicode text"),
        ({"label": 1}, TypeError, "label must be a string or None"),
        ({"label": "x" * 41}, ValueError, "at most 40 UTF-16 code units"),
        ({"label": "\U0001f642" * 21}, ValueError, "at most 40 UTF-16 code units"),
        ({"label": "\ud800"}, ValueError, "valid Unicode text"),
    ],
)
@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_reports_each_invalid_argument(
    runtime_reads: list[str],
    action: str,
    arguments: dict[str, Any],
    error: type[Exception],
    message: str,
) -> None:
    lens = BrowserLens()

    with pytest.raises(error, match=message):
        _attend(lens, action, **arguments)

    assert runtime_reads == []


@pytest.mark.parametrize(
    ("action", "arguments", "error", "message"),
    [
        ("start_activity", {"message": "x" * 241}, ValueError, "at most 240 UTF-16"),
        ("reveal", {"message": "\U0001f642" * 501}, ValueError, "at most 1000 UTF-16"),
        ("reveal", {"duration_ms": True}, TypeError, "must be an integer"),
        ("reveal", {"duration_ms": 1.5}, TypeError, "must be an integer"),
        ("reveal", {"duration_ms": "8000"}, TypeError, "must be an integer"),
        ("reveal", {"duration_ms": 300_001}, ValueError, "between 1 and 300000"),
        ("start_activity", {"duration_ms": 0}, ValueError, "between 1 and 300000"),
    ],
)
def test_target_attention_reports_each_bound(
    runtime_reads: list[str],
    action: str,
    arguments: dict[str, Any],
    error: type[Exception],
    message: str,
) -> None:
    lens = BrowserLens()

    with pytest.raises(error, match=message):
        _attend(lens, action, **arguments)

    assert runtime_reads == []


@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_rejects_a_closed_lens_before_runtime_access(
    runtime_reads: list[str], action: str
) -> None:
    lens = BrowserLens()
    lens.close()

    with pytest.raises(LensError) as raised:
        _attend(lens, action)

    assert raised.value.code == "lens_closed"
    assert runtime_reads == []


def test_lens_serializes_the_optional_dom_selector() -> None:
    lens = Lens(dom_selector="#app-shell :is(header, section)")

    assert lens._selector == "#app-shell :is(header, section)"
    lens.close()


@pytest.mark.parametrize(
    ("kwargs", "error", "message"),
    [
        ({"dom_selector": 3}, TypeError, "must be a string or None"),
        ({"dom_selector": "  "}, ValueError, "must not be empty"),
        ({"dom_selector": "\ufeff"}, ValueError, "nonblank valid Unicode"),
        ({"dom_selector": "\ud800"}, ValueError, "nonblank valid Unicode"),
        ({"dom_selector": "x" * 1_025}, ValueError, "at most 1,024"),
    ],
)
def test_lens_rejects_invalid_target_configuration(
    kwargs: dict[str, object],
    error: type[Exception],
    message: str,
) -> None:
    with pytest.raises(error, match=message):
        cast(Any, Lens)(**kwargs)


def test_stop_activity_rejects_a_closed_lens(runtime_reads: list[str]) -> None:
    lens = BrowserLens()
    activity = lens.start_activity("cell-view")
    lens.close()

    with pytest.raises(LensError) as raised:
        lens.stop_activity(activity)

    assert raised.value.code == "lens_closed"


def test_context_preserves_each_diagnostic_when_cell_lists_exceed_text_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer_ids = [f"cell-{index:02d}-" + "x" * 110 for index in range(64)]
    runtime = replace(
        snapshot(*(cell(cell_id, code="x" * 500) for cell_id in producer_ids)),
        omitted_cell_ids=tuple(f"omitted-{index}-" + "y" * 110 for index in range(16)),
        omitted_cell_count=16,
        cell_truncated_output_ids=frozenset(producer_ids),
        control_truncated_output_ids=frozenset(producer_ids),
        control_incomplete_output_ids=frozenset(producer_ids),
    )
    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "snapshot",
        lambda _self, _output_cell_ids: runtime,
    )
    lens = BrowserLens()
    try:
        lens.put(
            selection(
                target={
                    "kind": "dom",
                    "sources": [],
                    "cellIds": producer_ids,
                    "documentId": "document-1",
                    "documentPath": "/",
                    "domSelector": "#results",
                }
            )
        )

        text = lens.context().text

        assert "16 relevant cells were omitted" in text
        assert "Source was truncated" in text
        assert "Control sampling reached its per-output limit" in text
        assert "Control sampling could not read runtime values" in text
        assert len(text) <= 64_000
    finally:
        lens.close()


def test_pointer_release_selection_exists_before_image_capture() -> None:
    lens = BrowserLens()

    response = lens.put(selection(note=""))

    assert response["version"] == PROTOCOL_VERSION
    assert response["revision"] == 1
    assert response["payload"]["selection"]["label"] == "S1"
    assert lens.synced_state()["nextLabel"] == "S2"
    assert lens.synced_state()["currentSelectionId"] == "selection-1"
    assert _selections(lens)[0]["note"] == ""
    assert _selections(lens)[0]["snapshot"] == {"status": "pending"}
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S1"
    assert context.images == {}


def test_async_image_replace_does_not_steal_current_selection() -> None:
    lens = BrowserLens()
    lens.put(selection())
    lens.put(selection(selection_id="selection-2", label="S2"))
    data = png()

    lens.put(copy.deepcopy(_selections(lens)[0]), image=data)

    assert lens.synced_state()["currentSelectionId"] == "selection-2"
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S2"
    assert context.images == {"selection-1": data}


def test_editing_the_published_state_in_place_leaves_the_selection_alone() -> None:
    lens = BrowserLens()
    lens.put(selection(note="Central looks off"))

    _selections(lens)[0]["note"] = "edited outside Lens"

    context = lens.context()
    assert context.current is not None
    assert context.current["note"] == "Central looks off"


@pytest.mark.parametrize(
    ("trait", "foreign"),
    [
        (
            "_state",
            {
                "revision": 99,
                "nextLabel": "S99",
                "currentSelectionId": "selection-99",
                "selections": [selection()],
            },
        ),
        ("_selector", "#other"),
    ],
)
def test_synced_traits_are_python_owned(trait: str, foreign: object) -> None:
    lens = BrowserLens(dom_selector="#summary")
    owned = copy.deepcopy(getattr(lens, trait))

    lens.set_trait(trait, foreign)

    assert getattr(lens, trait) == owned
    lens.close()


def test_close_releases_images_and_rejects_later_context_and_commands() -> None:
    lens = BrowserLens()
    lens.put(selection(), image=png())

    lens.close()

    assert lens._session.state.image_bytes == 0
    with pytest.raises(LensError, match="Lens is closed") as error:
        lens.context()
    assert error.value.code == "lens_closed"
    assert error.value.revision == 1
    assert lens.refused("selections.clear", {"expectedRevision": 1}) == "lens_closed"


def test_selection_count_matches_the_provenance_capacity() -> None:
    lens = BrowserLens()
    for index in range(64):
        lens.put(
            selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
                output_cell_id=f"cell-{index + 1}",
            )
        )

    refused = _try_put(
        lens,
        selection(selection_id="selection-65", label="S65", output_cell_id="cell-65"),
    )

    assert refused["error"]["code"] == "selection_limit_reached"


def test_selection_image_that_disagrees_with_its_metadata_is_refused() -> None:
    lens = BrowserLens()
    data = png()
    value = selection()
    value["snapshot"] = {**snapshot_metadata(data), "width": 999}

    response = _try_put(lens, value, image_action="replace", image=data)

    assert response["error"]["code"] == "image_metadata_mismatch"
    assert _selections(lens) == []


def test_selection_growth_is_rejected_before_state_changes() -> None:
    lens = BrowserLens()
    accepted = 0
    while True:
        response = _try_put(
            lens,
            selection(
                selection_id=f"selection-{accepted + 1}",
                label=f"S{accepted + 1}",
                note="x" * 4_000,
            ),
        )
        if response["ok"] is False:
            break
        accepted += 1

    assert response["error"]["code"] == "selection_context_limit"
    assert lens.revision == accepted
    assert lens.synced_state()["nextLabel"] == f"S{accepted + 1}"
    assert len(_selections(lens)) == accepted
    assert lens.context().images == {}


def test_identifier_heavy_selections_fit_the_supported_selection_count() -> None:
    lens = BrowserLens()
    for index in range(63):
        prefix = f"{index}-"
        selection_value = selection(
            selection_id=prefix + "漢" * (80 - len(prefix)),
            label=f"S{index + 1}",
            output_cell_id=prefix + "界" * (80 - len(prefix)),
        )
        selection_value.pop("domHint")
        selection_value["description"] = {"label": "Output"}
        lens.put(selection_value)

    assert lens.revision == 63
    assert lens.synced_state()["nextLabel"] == "S64"
    assert len(_selections(lens)) == 63
    projected = lens.context().references["selections"]
    assert isinstance(projected, list)
    assert len(projected) == 63


def test_new_labels_are_server_checked_and_never_reused() -> None:
    lens = BrowserLens()
    lens.put(selection())
    _delete(lens, "selection-1")

    reused = _try_put(lens, selection(selection_id="selection-2", label="S1"))
    assert reused["error"]["code"] == "selection_label_conflict"
    assert lens.synced_state()["nextLabel"] == "S2"
    lens.put(selection(selection_id="selection-2", label="S2"))

    assert [item["label"] for item in _selections(lens)] == ["S2"]
    cleared = lens.command("selections.clear", {"expectedRevision": lens.revision})
    assert cleared["payload"] == {}
    assert lens.synced_state() == {
        "revision": 4,
        "nextLabel": "S3",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }


def test_resolve_removes_selection_and_image_and_preserves_label_allocation() -> None:
    lens = BrowserLens()
    data = png()
    lens.put(selection(), image=data)
    lens.put(selection(selection_id="selection-2", label="S2"))
    _activate(lens, "selection-1")

    revision = lens.resolve("selection-1", expected_revision=3)

    assert revision == 4
    assert lens.synced_state()["nextLabel"] == "S3"
    assert lens.synced_state()["currentSelectionId"] == "selection-2"
    assert [item["id"] for item in _selections(lens)] == ["selection-2"]
    [entry] = lens.history_entries()
    assert entry == {
        "description": {"label": "Cell cell-view"},
        "selectionId": "selection-1",
        "label": "S1",
        "note": "",
        "target": {
            "kind": "notebook",
            "cellIds": ["cell-view"],
            "documentId": "document-1",
            "documentPath": "/",
        },
        "createdAt": "2026-07-14T11:58:00Z",
        "addressedAt": entry["addressedAt"],
        "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
        "domHint": {
            "tag": "svg",
            "role": "img",
            "ariaLabel": "Sales by category",
            "text": "",
            "path": "div > svg",
            "bounds": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.6},
        },
        "resolutionRevision": 4,
    }
    assert lens.context().images == {}

    lens.put(selection(selection_id="selection-3", label="S3"))
    assert lens.synced_state()["nextLabel"] == "S4"


@pytest.mark.parametrize(
    ("summary", "kept"),
    [
        (
            "  Updated the aggregation cell and reran the chart.  ",
            "Updated the aggregation cell and reran the chart.",
        ),
        ("  ", None),
    ],
    ids=["summary", "blank-summary"],
)
def test_resolve_emits_one_transient_resolution_receipt(
    summary: str, kept: str | None
) -> None:
    lens = BrowserLens()
    lens.put(selection())

    revision = lens.resolve("selection-1", expected_revision=1, summary=summary)

    assert revision == 2
    event, buffers = lens.sent[-1]
    [entry] = lens.history_entries()
    assert event == {
        "protocol": "marimo-lens.event",
        "version": PROTOCOL_VERSION,
        "type": "selection.resolved",
        "revision": 2,
        "payload": {
            "selections": [
                {
                    "selectionId": "selection-1",
                    "label": "S1",
                    "resolutionRevision": 2,
                }
            ],
            **({} if kept is None else {"summary": kept}),
        },
    }
    assert buffers == []
    assert entry.get("summary") == kept
    assert "resolved" not in lens.synced_state()
    assert "resolved" not in lens.context().references
    assert "history" not in lens.context().references


def test_resolve_commits_multiple_selections_atomically() -> None:
    lens = BrowserLens()
    lens.put(selection())
    lens.put(selection(selection_id="selection-2", label="S2"))
    lens.put(selection(selection_id="selection-3", label="S3"))

    revision = lens.resolve(
        ["selection-3", "selection-1"],
        expected_revision=3,
        summary="Updated and verified both requests.",
    )

    assert revision == 4
    assert [item["id"] for item in _selections(lens)] == ["selection-2"]
    assert lens.synced_state()["currentSelectionId"] == "selection-2"
    history = lens.history_entries()
    assert [item["selectionId"] for item in history] == ["selection-3", "selection-1"]
    assert {item["resolutionRevision"] for item in history} == {4}
    event = lens.sent[-1][0]
    assert event["revision"] == 4
    assert [
        (item["selectionId"], item["label"]) for item in event["payload"]["selections"]
    ] == [("selection-3", "S3"), ("selection-1", "S1")]
    assert {item["resolutionRevision"] for item in event["payload"]["selections"]} == {
        4
    }


def test_browser_reopens_addressed_selection_and_clears_history() -> None:
    lens = BrowserLens()
    selected = selection(note="Please align this label.")
    description = {
        "label": "Athletes",
        "detail": "Browser aggregation",
        "renderSource": {"path": "src/report.ts", "symbol": "summarize", "line": 12},
        "media": {"path": "report.pdf", "page": 2},
    }
    selected["description"] = description
    lens.put(selected)
    context = lens.context()
    assert context.current is not None
    assert context.current.get("description") == description
    assert "src/report.ts" in context.text
    assert "client supplied" in context.text
    lens.resolve(
        selected["id"],
        expected_revision=1,
        summary="Aligned the label and verified the chart.",
    )
    [entry] = lens.history_entries()

    reopened = _reopen(lens, selected["id"], entry["resolutionRevision"])

    assert reopened["revision"] == 3
    assert reopened["payload"] == {"selectionId": selected["id"]}
    assert lens.history_entries() == [entry]
    assert entry["summary"] == "Aligned the label and verified the chart."
    assert entry["description"] == description
    [restored] = _selections(lens)
    assert {
        key: value for key, value in restored.items() if key != "previousResolution"
    } == {**selected, "snapshot": {"status": "pending"}}
    previous = {
        "addressedAt": entry["addressedAt"],
        "summary": "Aligned the label and verified the chart.",
    }
    assert restored["previousResolution"] == previous
    assert lens.synced_state()["currentSelectionId"] == selected["id"]
    context = lens.context()
    assert context.current is not None
    assert context.current.get("previousResolution") == previous
    assert "history" not in context.references

    cleared = lens.command("history.clear", {"expectedRevision": 3})

    assert cleared["revision"] == 4
    assert lens.history_entries() == []
    [active] = _selections(lens)
    assert "previousResolution" not in active
    assert active == {
        key: value for key, value in restored.items() if key != "previousResolution"
    }


def test_browser_reopen_requires_the_retained_receipt_revision() -> None:
    lens = BrowserLens()
    lens.put(selection())
    lens.resolve("selection-1", expected_revision=1)

    code = lens.refused("selection.reopen", _reopen_payload(lens, "selection-1", 99))

    assert code == "history_not_found"
    assert lens.revision == 2
    assert _selections(lens) == []
    assert len(lens.history_entries()) == 1


def test_resolve_preserves_the_exact_protocol_selection_id() -> None:
    lens = BrowserLens()
    selection_id = " selection-1 "
    lens.put(selection(selection_id=selection_id))

    lens.resolve(selection_id, expected_revision=1)

    assert lens.sent[-1][0]["payload"]["selections"][0]["selectionId"] == selection_id
    assert _selections(lens) == []


def test_resolve_rejects_stale_revision_without_changing_state() -> None:
    lens = BrowserLens()
    data = png()
    lens.put(selection(), image=data)
    before = copy.deepcopy(lens.synced_state())
    sent_before = len(lens.sent)

    with pytest.raises(LensError) as error:
        lens.resolve("selection-1", expected_revision=0)

    assert error.value.code == "revision_conflict"
    assert error.value.revision == 1
    assert lens.synced_state() == before
    assert lens.context().images["selection-1"] == data
    assert len(lens.sent) == sent_before


def test_resolve_rejects_unknown_selection_without_changing_state() -> None:
    lens = BrowserLens()
    lens.put(selection())
    before = copy.deepcopy(lens.synced_state())

    with pytest.raises(LensError) as error:
        lens.resolve(["selection-1", "selection-missing"], expected_revision=1)

    assert error.value.code == "selection_not_found"
    assert error.value.revision == 1
    assert lens.synced_state() == before


@pytest.mark.parametrize(
    ("selection_id", "revision", "summary", "error_type", "message"),
    [
        ("", 1, None, ValueError, "selection_id must not be empty"),
        (1, 1, None, TypeError, "selection_ids must be a string or a sequence"),
        ([], 1, None, ValueError, "at least one selection ID"),
        (["selection-1", "selection-1"], 1, None, ValueError, "duplicates"),
        ("x" * 129, 1, None, ValueError, "at most 128 UTF-16 code units"),
        ("\ud800", 1, None, ValueError, "valid Unicode text"),
        ("selection-1", -1, None, ValueError, "non-negative integer"),
        ("selection-1", True, None, TypeError, "must be an integer"),
        ("selection-1", "1", None, TypeError, "must be an integer"),
        ("selection-1", 1, 1, TypeError, "summary must be a string or None"),
        ("selection-1", 1, "x" * 241, ValueError, "at most 240 UTF-16 code units"),
        ("selection-1", 1, "\U0001f642" * 121, ValueError, "at most 240 UTF-16"),
        ("selection-1", 1, "\ud800", ValueError, "valid Unicode text"),
    ],
)
def test_resolve_validates_arguments_before_changing_state(
    selection_id: Any,
    revision: Any,
    summary: Any,
    error_type: type[Exception],
    message: str,
) -> None:
    lens = BrowserLens()
    lens.put(selection())
    before = copy.deepcopy(lens.synced_state())

    with pytest.raises(error_type, match=message):
        lens.resolve(selection_id, expected_revision=revision, summary=summary)

    assert lens.synced_state() == before


def test_resolve_rejects_a_closed_lens() -> None:
    lens = BrowserLens()
    lens.put(selection())
    lens.close()

    with pytest.raises(LensError) as error:
        lens.resolve("selection-1", expected_revision=1)

    assert error.value.code == "lens_closed"
    assert error.value.revision == 1


def test_resolution_receipt_failure_does_not_roll_back_resolution() -> None:
    lens = FailingEventLens()
    lens.put(selection())

    revision = lens.resolve("selection-1", expected_revision=1)

    assert revision == 2
    assert lens.synced_state() == {
        "revision": 2,
        "nextLabel": "S2",
        "currentSelectionId": None,
        "selections": [],
        "history": lens.history_entries(),
    }
    assert [
        (entry["selectionId"], entry["resolutionRevision"])
        for entry in lens.history_entries()
    ] == [("selection-1", 2)]


def test_concurrent_resolutions_emit_receipts_in_revision_order() -> None:
    lens = DelayedEventLens()
    lens.put(selection())
    lens.put(selection(selection_id="selection-2", label="S2"))

    def resolve_second() -> None:
        try:
            lens.resolve("selection-2", expected_revision=3)
        finally:
            lens.second_resolution_finished.set()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            lens.resolve,
            "selection-1",
            expected_revision=2,
        )
        assert lens.first_event_started.wait(timeout=1)
        second = executor.submit(resolve_second)
        first.result(timeout=2)
        second.result(timeout=2)

    events = [
        content
        for content, _buffers in lens.sent
        if content.get("protocol") == "marimo-lens.event"
    ]
    assert [event["revision"] for event in events] == [3, 4]


def test_resolve_rolls_back_when_authoritative_state_cannot_publish() -> None:
    lens = FailingPublishLens()
    data = png()
    lens.put(selection(), image=data)
    lens.put(selection(selection_id="selection-2", label="S2"))
    _activate(lens, "selection-1")
    before = copy.deepcopy(lens.synced_state())
    sent_before = len(lens.sent)
    lens.fail_next_state_publish = True

    with pytest.raises(RuntimeError, match="state publish failed"):
        lens.resolve("selection-1", expected_revision=3)

    assert lens.synced_state() == before
    assert lens.context().images["selection-1"] == data
    assert len(lens.sent) == sent_before


def test_creation_activation_and_note_edits_define_current_selection() -> None:
    lens = BrowserLens()
    lens.put(selection())
    lens.put(selection(selection_id="selection-2", label="S2"))
    assert lens.synced_state()["currentSelectionId"] == "selection-2"

    activated = _activate(lens, "selection-1")
    assert activated["payload"] == {"selectionId": "selection-1"}
    assert lens.synced_state()["currentSelectionId"] == "selection-1"

    edited = copy.deepcopy(_selections(lens)[1])
    edited["note"] = "Use this selection."
    assert _try_put(lens, edited, image_action="preserve")["ok"] is True
    assert lens.synced_state()["currentSelectionId"] == "selection-2"


def test_deleting_current_falls_back_to_most_recent_remaining_selection() -> None:
    lens = BrowserLens()
    for index in range(3):
        lens.put(
            selection(selection_id=f"selection-{index + 1}", label=f"S{index + 1}")
        )
    _activate(lens, "selection-1")
    _activate(lens, "selection-3")

    _delete(lens, "selection-3")

    assert lens.synced_state()["currentSelectionId"] == "selection-1"
    _delete(lens, "selection-2")
    assert lens.synced_state()["currentSelectionId"] == "selection-1"
    _delete(lens, "selection-1")
    assert lens.synced_state()["currentSelectionId"] is None


def test_a_put_may_change_the_note_but_not_the_capture_or_identity() -> None:
    lens = BrowserLens()
    data = png()
    lens.put(selection(), image=data)
    edited = copy.deepcopy(_selections(lens)[0])
    edited["note"] = "Use the table ordering here."

    assert _try_put(lens, edited, image_action="preserve")["ok"] is True
    assert _selections(lens)[0]["note"] == edited["note"]
    assert lens.context().images["selection-1"] == data

    moved = copy.deepcopy(_selections(lens)[0])
    moved["anchor"]["x"] = 0.5
    renamed = copy.deepcopy(_selections(lens)[0])
    renamed["description"] = {"label": "Different result"}
    assert _try_put(lens, moved, image_action="preserve")["error"]["code"] == (
        "selection_capture_changed"
    )
    assert _try_put(lens, renamed, image_action="preserve")["error"]["code"] == (
        "selection_identity_changed"
    )
    assert lens.revision == 2


def test_outdated_snapshot_retains_capture_bytes() -> None:
    lens = BrowserLens()
    data = png()
    lens.put(selection(), image=data)
    outdated = copy.deepcopy(_selections(lens)[0])
    outdated["anchor"]["x"] = 0.5
    outdated["snapshot"]["status"] = "outdated"

    assert _try_put(lens, outdated, image_action="preserve")["ok"] is True

    context = lens.context()
    references = cast(dict[str, Any], context.references)
    assert references["selections"][0]["snapshot"] == {"status": "outdated"}
    assert references["selections"][0]["anchor"]["x"] == 0.5
    assert context.images["selection-1"] == data
    response = lens.command("snapshot.get", {"selectionId": "selection-1"})
    assert response["payload"]["selectionId"] == "selection-1"
    assert response["payload"]["snapshot"]["status"] == "outdated"
    assert response["payload"]["snapshot"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert lens.sent[-1][1] == [data]


def test_every_mutation_rejects_stale_revision_before_changing_state() -> None:
    lens = BrowserLens()
    lens.put(selection())
    stale = {"selectionId": "selection-1", "expectedRevision": 0}

    stale_put = _try_put(
        lens, copy.deepcopy(_selections(lens)[0]), image_action="preserve", revision=0
    )

    assert stale_put["error"]["code"] == "revision_conflict"
    assert lens.refused("selection.activate", stale) == "revision_conflict"
    assert lens.refused("selection.delete", stale) == "revision_conflict"
    assert (
        lens.refused("selections.clear", {"expectedRevision": 0}) == "revision_conflict"
    )
    assert lens.revision == 1
    assert lens.synced_state()["currentSelectionId"] == "selection-1"


def test_trait_publish_failure_rolls_back_selection_current_mru_and_image() -> None:
    lens = FailingPublishLens()
    data = png()
    lens.fail_next_state_publish = True

    failed_put = _try_put(
        lens,
        selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
        image=data,
    )

    assert failed_put["error"]["code"] == "internal_error"
    assert lens.synced_state() == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }
    assert lens.context().images == {}

    for index in range(3):
        lens.put(
            selection(selection_id=f"selection-{index + 1}", label=f"S{index + 1}")
        )
    lens.fail_next_state_publish = True
    failed_activate = lens.respond(
        "selection.activate", {"selectionId": "selection-1", "expectedRevision": 3}
    )
    assert failed_activate["error"]["code"] == "internal_error"
    assert lens.synced_state()["currentSelectionId"] == "selection-3"

    _delete(lens, "selection-3")
    assert lens.synced_state()["currentSelectionId"] == "selection-2"


def _selections(lens: BrowserLens) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], lens.synced_state()["selections"])


def _try_put(
    lens: BrowserLens,
    value: dict[str, Any],
    *,
    image_action: str = "clear",
    image: bytes | None = None,
    revision: int | None = None,
) -> dict[str, Any]:
    return lens.respond(
        "selection.put",
        {
            "selection": value,
            "expectedRevision": lens.revision if revision is None else revision,
            "imageAction": image_action,
        },
        buffers=() if image is None else [image],
    )


def _activate(
    lens: BrowserLens, selection_id: str, *, revision: int | None = None
) -> dict[str, Any]:
    return lens.command(
        "selection.activate",
        {
            "selectionId": selection_id,
            "expectedRevision": lens.revision if revision is None else revision,
        },
    )


def _delete(lens: BrowserLens, selection_id: str) -> dict[str, Any]:
    return lens.command(
        "selection.delete",
        {"selectionId": selection_id, "expectedRevision": lens.revision},
    )


def _reopen_payload(
    lens: BrowserLens, selection_id: str, resolution_revision: int
) -> dict[str, Any]:
    return {
        "selectionId": selection_id,
        "resolutionRevision": resolution_revision,
        "expectedRevision": lens.revision,
    }


def _reopen(
    lens: BrowserLens, selection_id: str, resolution_revision: int
) -> dict[str, Any]:
    return lens.command(
        "selection.reopen", _reopen_payload(lens, selection_id, resolution_revision)
    )
