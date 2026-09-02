from __future__ import annotations

import copy
import inspect
import json
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, cast

import marimo_lens
import pytest
from marimo_lens import (
    ActivityHandle,
    CellReference,
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    SelectionReference,
)

from tests.support.factories import (
    png,
    selection,
    snapshot_metadata,
)


class RecordingLens(Lens):
    sent: list[tuple[dict[str, Any], list[bytes]]]

    def __init__(self) -> None:
        self.sent = []
        super().__init__()

    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        self.sent.append((content, [bytes(buffer) for buffer in buffers or []]))


class FailingPublishLens(RecordingLens):
    fail_next_state_publish = False

    def set_trait(self, name: str, value: Any) -> None:
        if name == "_state" and self.fail_next_state_publish:
            self.fail_next_state_publish = False
            raise RuntimeError("state publish failed")
        super().set_trait(name, value)


class FailingEventLens(RecordingLens):
    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        if content.get("protocol") == "marimo-lens.event":
            raise RuntimeError("browser disconnected")
        super().send(content, buffers)


class DelayedEventLens(RecordingLens):
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


def test_public_api_exposes_context_and_resolution_contracts() -> None:
    assert marimo_lens.__all__ == [
        "ActivityHandle",
        "CellReference",
        "Lens",
        "LensContext",
        "LensError",
        "LensReferences",
        "NotebookReference",
        "SelectionReference",
        "SelectionTargetReference",
        "__version__",
    ]
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
    reveal_parameters = inspect.signature(Lens.reveal).parameters
    assert list(reveal_parameters) == [
        "self",
        "target",
        "expected_revision",
        "duration_ms",
        "label",
        "message",
    ]
    assert reveal_parameters["message"].kind is inspect.Parameter.KEYWORD_ONLY
    assert reveal_parameters["message"].default is None
    assert reveal_parameters["duration_ms"].kind is inspect.Parameter.KEYWORD_ONLY
    assert reveal_parameters["duration_ms"].default is inspect.Parameter.empty
    assert reveal_parameters["label"].kind is inspect.Parameter.KEYWORD_ONLY
    assert reveal_parameters["label"].default is None
    start_activity_parameters = inspect.signature(Lens.start_activity).parameters
    assert list(start_activity_parameters) == [
        "self",
        "target",
        "expected_revision",
        "duration_ms",
        "label",
        "message",
    ]
    assert (
        start_activity_parameters["duration_ms"].kind is inspect.Parameter.KEYWORD_ONLY
    )
    assert start_activity_parameters["duration_ms"].default is None
    assert start_activity_parameters["label"].kind is inspect.Parameter.KEYWORD_ONLY
    assert start_activity_parameters["label"].default is None
    assert start_activity_parameters["message"].kind is inspect.Parameter.KEYWORD_ONLY
    assert start_activity_parameters["message"].default is None
    stop_activity_parameters = inspect.signature(Lens.stop_activity).parameters
    assert list(stop_activity_parameters) == ["self", "activity"]
    assert ActivityHandle.__module__ == "marimo_lens.activity"
    assert LensContext.__module__ == "marimo_lens.context"
    assert LensError.__module__ == "marimo_lens.errors"
    assert LensReferences.__module__ == "marimo_lens.context"
    assert CellReference.__module__ == "marimo_lens.context"
    assert NotebookReference.__module__ == "marimo_lens.context"
    assert SelectionReference.__module__ == "marimo_lens.context"

    lens = RecordingLens()
    assert not hasattr(lens, "images")

    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }


def test_reveal_sends_one_transient_event_without_changing_selection_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: "available",
    )
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    before = copy.deepcopy(_state(lens))

    lens.reveal(
        "cell-view",
        label="Updated chart",
        message="  Updated the aggregation used by the chart.  ",
        duration_ms=8_000,
    )

    assert lens.sent[-1] == (
        {
            "protocol": "marimo-lens.event",
            "version": 4,
            "type": "attention.reveal",
            "payload": {
                "address": {"kind": "cell", "cellId": "cell-view"},
                "label": "Updated chart",
                "message": "Updated the aggregation used by the chart.",
                "durationMs": 8_000,
            },
        },
        [],
    )
    assert _state(lens) == before
    context = lens.context()
    assert "reveal" not in json.dumps(context.references)
    assert "Updated the aggregation" not in context.text
    assert lens.resolve("selection-1", expected_revision=1) == 2


def test_reveal_uses_the_caller_supplied_hold_for_a_long_result_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: "available",
    )
    lens = RecordingLens()
    message = "x" * 1_000

    lens.reveal(
        "cell-view",
        duration_ms=120_000,
        message=message,
    )

    assert lens.sent[-1][0]["payload"] == {
        "address": {"kind": "cell", "cellId": "cell-view"},
        "message": message,
        "durationMs": 120_000,
    }


def test_start_activity_sends_one_transient_event_without_changing_selection_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: "available",
    )
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    before = copy.deepcopy(_state(lens))

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
            "version": 4,
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
    assert _state(lens) == before
    context = lens.context()
    assert "activity" not in json.dumps(context.references)
    assert "Updating the aggregation" not in context.text


def test_stop_activity_sends_one_matching_owner_event_without_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False
    runtime_status = "available"

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return runtime_status

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    before = copy.deepcopy(_state(lens))

    activity = lens.start_activity("cell-view")
    start_event = lens.sent[-1][0]
    runtime_accessed = False
    runtime_status = "missing"

    restored_activity = ActivityHandle(json.loads(json.dumps(activity)))
    lens.stop_activity(restored_activity)

    assert lens.sent[-1] == (
        {
            "protocol": "marimo-lens.event",
            "version": 4,
            "type": "attention.activity.stop",
            "payload": {"activityId": start_event["payload"]["activityId"]},
        },
        [],
    )
    assert _state(lens) == before
    assert not runtime_accessed


def test_selection_attention_uses_stored_identity_and_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "missing"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    _put(
        lens,
        revision=0,
        selection_value=selection(
            target={
                "kind": "dom",
                "cellIds": [],
                "documentId": "document-1",
                "documentPath": "/dashboard/",
                "domSelector": "#summary",
            }
        ),
    )
    context = lens.context()
    reference = context.current
    assert reference is not None
    before = copy.deepcopy(_state(lens))

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
    assert lens.sent[-2][0]["payload"]["address"] == address
    assert "domSelector" not in lens.sent[-3][0]["payload"]
    assert _state(lens) == before
    assert not runtime_accessed


@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_selection_attention_rejects_a_stale_revision(action: str) -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    reference = lens.context().current
    assert reference is not None
    sent_before = len(lens.sent)

    duration = {"duration_ms": 4_000} if action == "reveal" else {}
    with pytest.raises(LensError) as raised:
        getattr(lens, action)(reference, expected_revision=0, **duration)

    assert raised.value.code == "revision_conflict"
    assert raised.value.revision == 1
    assert len(lens.sent) == sent_before


def test_selection_attention_rejects_a_missing_selection() -> None:
    lens = RecordingLens()
    missing = cast(
        SelectionReference,
        {"id": "selection-missing"},
    )

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
    lens = RecordingLens()

    with pytest.raises(error):
        lens.stop_activity(cast(ActivityHandle, activity))

    assert lens.sent == []


@pytest.mark.parametrize(
    "action",
    ["start_activity", "reveal"],
)
def test_target_attention_omits_an_empty_message_and_tolerates_delivery_failure(
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: "available",
    )
    lens = FailingEventLens()

    duration = {"duration_ms": 4_000} if action == "reveal" else {}
    result = getattr(lens, action)("cell-view", message="  ", **duration)
    if action == "reveal":
        assert result is None
    else:
        assert isinstance(result, str)
    assert _state(lens)["revision"] == 0


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
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: status,
    )
    lens = RecordingLens()
    sent_before = len(lens.sent)
    duration = {"duration_ms": 4_000} if action == "reveal" else {}

    with pytest.raises(LensError) as raised:
        getattr(lens, action)("cell-view", **duration)

    assert raised.value.code == code
    assert raised.value.revision == 0
    assert len(lens.sent) == sent_before


@pytest.mark.parametrize(
    ("cell_id", "message", "error_type", "error_message"),
    [
        (1, None, TypeError, "target must be a cell ID or SelectionReference"),
        ("", None, ValueError, "cell_id must not be empty"),
        ("x" * 129, None, ValueError, "at most 128 UTF-16 code units"),
        ("cell-view", 1, TypeError, "message must be a string or None"),
        ("cell-view", "\ud800", ValueError, "valid Unicode text"),
    ],
)
@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_validates_arguments_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
    cell_id: Any,
    message: Any,
    error_type: type[Exception],
    error_message: str,
    action: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    duration = {"duration_ms": 4_000} if action == "reveal" else {}

    with pytest.raises(error_type, match=error_message):
        getattr(lens, action)(cell_id, message=message, **duration)

    assert not runtime_accessed


@pytest.mark.parametrize(
    ("action", "message", "maximum"),
    [
        ("start_activity", "x" * 241, 240),
        ("start_activity", "\U0001f642" * 121, 240),
        ("reveal", "x" * 1_001, 1_000),
        ("reveal", "\U0001f642" * 501, 1_000),
    ],
)
def test_target_attention_enforces_its_message_bound_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    message: str,
    maximum: int,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    duration = {"duration_ms": 4_000} if action == "reveal" else {}

    with pytest.raises(
        ValueError,
        match=f"at most {maximum} UTF-16 code units",
    ):
        getattr(lens, action)("cell-view", message=message, **duration)

    assert not runtime_accessed


@pytest.mark.parametrize(
    ("duration_ms", "error_type", "message"),
    [
        (None, TypeError, "duration_ms must be an integer"),
        (True, TypeError, "duration_ms must be an integer"),
        (1.5, TypeError, "duration_ms must be an integer"),
        ("8000", TypeError, "duration_ms must be an integer"),
        (0, ValueError, "between 1 and 300000 milliseconds"),
        (300_001, ValueError, "between 1 and 300000 milliseconds"),
    ],
)
def test_reveal_validates_duration_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
    duration_ms: Any,
    error_type: type[Exception],
    message: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()

    with pytest.raises(error_type, match=message):
        lens.reveal(
            "cell-view",
            duration_ms=duration_ms,
        )

    assert not runtime_accessed


def test_start_activity_validates_a_supplied_duration_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()

    with pytest.raises(ValueError, match="between 1 and 300000 milliseconds"):
        lens.start_activity("cell-view", duration_ms=0)

    assert not runtime_accessed


@pytest.mark.parametrize(
    ("label", "error_type", "message"),
    [
        (1, TypeError, "label must be a string or None"),
        ("x" * 41, ValueError, "at most 40 UTF-16 code units"),
        ("\U0001f642" * 21, ValueError, "at most 40 UTF-16 code units"),
        ("\ud800", ValueError, "valid Unicode text"),
    ],
)
@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_validates_its_label_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
    label: Any,
    error_type: type[Exception],
    message: str,
    action: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    duration = {"duration_ms": 4_000} if action == "reveal" else {}

    with pytest.raises(error_type, match=message):
        getattr(lens, action)("cell-view", label=label, **duration)

    assert not runtime_accessed


@pytest.mark.parametrize("action", ["start_activity", "reveal"])
def test_target_attention_rejects_a_closed_lens_before_runtime_access(
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime_accessed = False

    def access_runtime(_self: object, _cell_id: str) -> str:
        nonlocal runtime_accessed
        runtime_accessed = True
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", access_runtime)
    lens = RecordingLens()
    lens.close()
    duration = {"duration_ms": 4_000} if action == "reveal" else {}

    with pytest.raises(LensError) as raised:
        getattr(lens, action)("cell-view", **duration)

    assert raised.value.code == "lens_closed"
    assert not runtime_accessed


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


def test_stop_activity_rejects_a_closed_lens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: "available",
    )
    lens = RecordingLens()
    activity = lens.start_activity("cell-view")
    lens.close()

    with pytest.raises(LensError) as raised:
        lens.stop_activity(activity)

    assert raised.value.code == "lens_closed"


def test_pointer_release_selection_exists_before_image_capture() -> None:
    lens = RecordingLens()

    response = _put(lens, revision=0, selection_value=selection(note=""))

    assert response["ok"] is True
    assert response["version"] == 4
    assert response["revision"] == 1
    assert response["payload"]["selection"]["label"] == "S1"
    assert _state(lens)["nextLabel"] == "S2"
    assert _state(lens)["currentSelectionId"] == "selection-1"
    assert _selections(lens)[0]["note"] == ""
    assert _selections(lens)[0]["snapshot"] == {"status": "pending"}
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S1"
    assert context.images == {}


def test_async_image_replace_does_not_steal_current_selection() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    data = png()
    first = copy.deepcopy(_selections(lens)[0])
    first["snapshot"] = snapshot_metadata(data)

    response = _put(
        lens,
        revision=2,
        selection_value=first,
        data=data,
        image_action="replace",
    )

    assert response["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-2"
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S2"
    assert context.images == {"selection-1": data}


def test_synced_state_is_a_python_owned_projection() -> None:
    lens = RecordingLens()

    lens.set_trait(
        "_state",
        {
            "revision": 99,
            "nextLabel": "S99",
            "currentSelectionId": "selection-99",
            "selections": [selection()],
        },
    )

    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }


def test_synced_selector_is_a_python_owned_configuration() -> None:
    lens = Lens(dom_selector="#summary")

    lens.set_trait("_selector", "#other")

    assert lens._selector == "#summary"
    lens.close()


def test_close_releases_images_and_rejects_later_context_and_commands() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )

    lens.close()

    assert lens._selection_store.state.image_bytes == 0
    with pytest.raises(LensError, match="Lens is closed") as error:
        lens.context()
    assert error.value.code == "lens_closed"
    assert error.value.revision == 1

    response = _clear(lens, revision=1)
    assert response["ok"] is False
    assert response["error"]["code"] == "lens_closed"


def test_selection_count_matches_the_provenance_capacity() -> None:
    lens = RecordingLens()
    for index in range(64):
        response = _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
                output_cell_id=f"cell-{index + 1}",
            ),
        )
        assert response["ok"] is True

    response = _put(
        lens,
        revision=64,
        selection_value=selection(
            selection_id="selection-65",
            label="S65",
            output_cell_id="cell-65",
        ),
    )

    assert response["ok"] is False
    assert response["error"]["code"] == "selection_limit_reached"


def test_selection_growth_is_rejected_before_state_changes() -> None:
    lens = RecordingLens()
    accepted = 0
    while True:
        response = _put(
            lens,
            revision=accepted,
            selection_value=selection(
                selection_id=f"selection-{accepted + 1}",
                label=f"S{accepted + 1}",
                note="x" * 4_000,
            ),
        )
        if response["ok"] is False:
            break
        accepted += 1

    assert response["error"]["code"] == "selection_context_limit"
    assert _state(lens)["revision"] == accepted
    assert _state(lens)["nextLabel"] == f"S{accepted + 1}"
    assert len(_selections(lens)) == accepted
    assert lens.context().images == {}


def test_identifier_heavy_selections_fit_the_supported_selection_count() -> None:
    lens = RecordingLens()
    response: dict[str, Any] = {}
    for index in range(63):
        prefix = f"{index}-"
        selection_value = selection(
            selection_id=prefix + "漢" * (80 - len(prefix)),
            label=f"S{index + 1}",
            output_cell_id=prefix + "界" * (80 - len(prefix)),
        )
        selection_value.pop("domHint")
        response = _put(
            lens,
            revision=index,
            selection_value=selection_value,
        )
        assert response["ok"] is True

    assert _state(lens)["revision"] == 63
    assert _state(lens)["nextLabel"] == "S64"
    assert len(_selections(lens)) == 63
    projected = lens.context().references["selections"]
    assert isinstance(projected, list)
    assert len(projected) == 63


def test_new_labels_are_server_checked_and_never_reused() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _delete(lens, revision=1, selection_id="selection-1")

    reused = _put(
        lens,
        revision=2,
        selection_value=selection(selection_id="selection-2", label="S1"),
    )
    assert reused["ok"] is False
    assert reused["error"]["code"] == "selection_label_conflict"
    assert _state(lens)["nextLabel"] == "S2"

    accepted = _put(
        lens,
        revision=2,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    assert accepted["ok"] is True
    _clear(lens, revision=3)
    assert _state(lens) == {
        "revision": 4,
        "nextLabel": "S3",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }


def test_resolve_removes_selection_and_image_and_preserves_label_allocation() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    _activate(lens, revision=2, selection_id="selection-1")

    revision = lens.resolve("selection-1", expected_revision=3)

    assert revision == 4
    assert _state(lens)["revision"] == 4
    assert _state(lens)["nextLabel"] == "S3"
    assert _state(lens)["currentSelectionId"] == "selection-2"
    assert [item["id"] for item in _selections(lens)] == ["selection-2"]
    assert _state(lens)["history"][0] == {
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
        "addressedAt": _state(lens)["history"][0]["addressedAt"],
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

    created = _put(
        lens,
        revision=4,
        selection_value=selection(selection_id="selection-3", label="S3"),
    )
    assert created["ok"] is True
    assert _state(lens)["nextLabel"] == "S4"


def test_resolve_emits_one_transient_resolution_receipt() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())

    revision = lens.resolve(
        "selection-1",
        expected_revision=1,
        summary="  Updated the aggregation cell and reran the chart.  ",
    )

    assert revision == 2
    event, buffers = lens.sent[-1]
    assert event == {
        "protocol": "marimo-lens.event",
        "version": 4,
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
            "summary": "Updated the aggregation cell and reran the chart.",
        },
    }
    assert buffers == []
    assert _state(lens)["history"][0]["summary"] == (
        "Updated the aggregation cell and reran the chart."
    )
    assert "resolved" not in _state(lens)
    assert "resolved" not in lens.context().references
    assert "history" not in lens.context().references


def test_resolve_commits_multiple_selections_atomically() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    _put(
        lens,
        revision=2,
        selection_value=selection(selection_id="selection-3", label="S3"),
    )

    revision = lens.resolve(
        ["selection-3", "selection-1"],
        expected_revision=3,
        summary="Updated and verified both requests.",
    )

    assert revision == 4
    assert [item["id"] for item in _selections(lens)] == ["selection-2"]
    assert _state(lens)["currentSelectionId"] == "selection-2"
    assert [item["selectionId"] for item in _state(lens)["history"]] == [
        "selection-3",
        "selection-1",
    ]
    assert {item["resolutionRevision"] for item in _state(lens)["history"]} == {4}
    event = lens.sent[-1][0]
    assert event["revision"] == 4
    assert event["payload"]["selections"] == [
        {
            "selectionId": "selection-3",
            "label": "S3",
            "resolutionRevision": 4,
        },
        {
            "selectionId": "selection-1",
            "label": "S1",
            "resolutionRevision": 4,
        },
    ]


def test_browser_reopens_addressed_selection_and_clears_history() -> None:
    lens = RecordingLens()
    selected = selection(note="Please align this label.")
    _put(lens, revision=0, selection_value=selected)
    lens.resolve(
        selected["id"],
        expected_revision=1,
        summary="Aligned the label and verified the chart.",
    )

    reopened = _reopen(
        lens,
        revision=2,
        selection_id=selected["id"],
        resolution_revision=2,
    )

    assert reopened["ok"] is True
    assert reopened["revision"] == 3
    assert reopened["payload"] == {"selectionId": selected["id"]}
    assert _state(lens)["history"][0]["summary"] == (
        "Aligned the label and verified the chart."
    )
    restored = _selections(lens)[0]
    assert restored["id"] == selected["id"]
    assert restored["label"] == selected["label"]
    assert restored["note"] == selected["note"]
    assert restored["target"] == selected["target"]
    assert restored["anchor"] == selected["anchor"]
    assert restored["snapshot"] == {"status": "pending"}
    assert restored["previousResolution"] == {
        "addressedAt": _state(lens)["history"][0]["addressedAt"],
        "summary": "Aligned the label and verified the chart.",
    }
    assert _state(lens)["currentSelectionId"] == selected["id"]
    context = lens.context()
    assert context.current is not None
    assert context.current["previousResolution"] == {
        "addressedAt": _state(lens)["history"][0]["addressedAt"],
        "summary": "Aligned the label and verified the chart.",
    }
    assert "history" not in context.references

    cleared = _clear_history(lens, revision=3)
    assert cleared["ok"] is True
    assert cleared["revision"] == 4
    assert _state(lens)["history"] == []
    active = _selections(lens)
    assert len(active) == 1
    assert "previousResolution" not in active[0]
    assert {
        key: value for key, value in active[0].items() if key != "previousResolution"
    } == {key: value for key, value in restored.items() if key != "previousResolution"}


def test_browser_reopen_requires_the_retained_receipt_revision() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    lens.resolve("selection-1", expected_revision=1)

    response = _reopen(
        lens,
        revision=2,
        selection_id="selection-1",
        resolution_revision=99,
    )

    assert response["ok"] is False
    assert response["error"]["code"] == "history_not_found"
    assert _state(lens)["revision"] == 2
    assert _state(lens)["selections"] == []
    assert len(_state(lens)["history"]) == 1


def test_resolve_omits_an_empty_summary() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())

    lens.resolve("selection-1", expected_revision=1, summary="  ")

    assert lens.sent[-1][0]["payload"] == {
        "selections": [
            {
                "selectionId": "selection-1",
                "label": "S1",
                "resolutionRevision": 2,
            }
        ],
    }


def test_resolve_preserves_the_exact_protocol_selection_id() -> None:
    lens = RecordingLens()
    selection_id = " selection-1 "
    _put(
        lens,
        revision=0,
        selection_value=selection(selection_id=selection_id),
    )

    lens.resolve(selection_id, expected_revision=1)

    assert lens.sent[-1][0]["payload"]["selections"][0]["selectionId"] == selection_id
    assert _selections(lens) == []


def test_resolve_rejects_stale_revision_without_changing_state() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    before = copy.deepcopy(_state(lens))
    sent_before = len(lens.sent)

    with pytest.raises(LensError) as error:
        lens.resolve("selection-1", expected_revision=0)

    assert error.value.code == "revision_conflict"
    assert error.value.revision == 1
    assert _state(lens) == before
    assert lens.context().images["selection-1"] == data
    assert len(lens.sent) == sent_before


def test_resolve_rejects_unknown_selection_without_changing_state() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    before = copy.deepcopy(_state(lens))

    with pytest.raises(LensError) as error:
        lens.resolve("selection-missing", expected_revision=1)

    assert error.value.code == "selection_not_found"
    assert error.value.revision == 1
    assert _state(lens) == before


@pytest.mark.parametrize(
    ("selection_id", "revision", "summary", "error_type", "message"),
    [
        ("", 1, None, ValueError, "selection_id must not be empty"),
        (
            1,
            1,
            None,
            TypeError,
            "selection_ids must be a string or a sequence of strings",
        ),
        ([], 1, None, ValueError, "at least one selection ID"),
        (
            ["selection-1", "selection-1"],
            1,
            None,
            ValueError,
            "must not contain duplicates",
        ),
        (
            "x" * 129,
            1,
            None,
            ValueError,
            "at most 128 UTF-16 code units",
        ),
        ("\ud800", 1, None, ValueError, "valid Unicode text"),
        ("selection-1", -1, None, ValueError, "non-negative integer"),
        ("selection-1", True, None, TypeError, "must be an integer"),
        ("selection-1", "1", None, TypeError, "must be an integer"),
        ("selection-1", 1, 1, TypeError, "summary must be a string or None"),
        ("selection-1", 1, "x" * 241, ValueError, "at most 240 UTF-16 code units"),
        (
            "selection-1",
            1,
            "\U0001f642" * 121,
            ValueError,
            "at most 240 UTF-16 code units",
        ),
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
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    before = copy.deepcopy(_state(lens))

    with pytest.raises(error_type, match=message):
        lens.resolve(
            selection_id,
            expected_revision=revision,
            summary=summary,
        )

    assert _state(lens) == before


def test_resolve_rejects_a_closed_lens() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    lens.close()

    with pytest.raises(LensError) as error:
        lens.resolve("selection-1", expected_revision=1)

    assert error.value.code == "lens_closed"
    assert error.value.revision == 1


def test_resolution_receipt_failure_does_not_roll_back_resolution() -> None:
    lens = FailingEventLens()
    _put(lens, revision=0, selection_value=selection())

    revision = lens.resolve("selection-1", expected_revision=1)

    assert revision == 2
    assert _state(lens)["revision"] == 2
    assert _state(lens)["nextLabel"] == "S2"
    assert _state(lens)["currentSelectionId"] is None
    assert _state(lens)["selections"] == []
    assert _state(lens)["history"][0]["selectionId"] == "selection-1"
    assert _state(lens)["history"][0]["resolutionRevision"] == 2


def test_concurrent_resolutions_emit_receipts_in_revision_order() -> None:
    lens = DelayedEventLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )

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
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    _activate(lens, revision=2, selection_id="selection-1")
    before = copy.deepcopy(_state(lens))
    sent_before = len(lens.sent)
    lens.fail_next_state_publish = True

    with pytest.raises(RuntimeError, match="state publish failed"):
        lens.resolve("selection-1", expected_revision=3)

    assert _state(lens) == before
    assert lens.context().images["selection-1"] == data
    assert len(lens.sent) == sent_before


def test_creation_activation_and_note_edits_define_current_selection() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    assert _state(lens)["currentSelectionId"] == "selection-2"

    activated = _activate(lens, revision=2, selection_id="selection-1")
    assert activated["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-1"

    edited = copy.deepcopy(_selections(lens)[1])
    edited["note"] = "Use this selection."
    response = _put(
        lens,
        revision=3,
        selection_value=edited,
        image_action="preserve",
    )
    assert response["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-2"


def test_deleting_current_falls_back_to_most_recent_remaining_selection() -> None:
    lens = RecordingLens()
    for index in range(3):
        _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
            ),
        )
    _activate(lens, revision=3, selection_id="selection-1")
    _activate(lens, revision=4, selection_id="selection-3")

    _delete(lens, revision=5, selection_id="selection-3")

    assert _state(lens)["currentSelectionId"] == "selection-1"
    _delete(lens, revision=6, selection_id="selection-2")
    assert _state(lens)["currentSelectionId"] == "selection-1"
    _delete(lens, revision=7, selection_id="selection-1")
    assert _state(lens)["currentSelectionId"] is None


def test_preserve_can_change_note_without_changing_capture_geometry() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    edited = copy.deepcopy(_selections(lens)[0])
    edited["note"] = "Use the table ordering here."

    response = _put(
        lens,
        revision=1,
        selection_value=edited,
        image_action="preserve",
    )

    assert response["ok"] is True
    assert _selections(lens)[0]["note"] == edited["note"]
    assert lens.context().images["selection-1"] == data

    moved = copy.deepcopy(_selections(lens)[0])
    moved["anchor"]["x"] = 0.5
    rejected = _put(
        lens,
        revision=2,
        selection_value=moved,
        image_action="preserve",
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "selection_capture_changed"
    assert _state(lens)["revision"] == 2


def test_outdated_snapshot_retains_capture_bytes() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    outdated = copy.deepcopy(_selections(lens)[0])
    outdated["anchor"]["x"] = 0.5
    outdated["snapshot"]["status"] = "outdated"

    response = _put(
        lens,
        revision=1,
        selection_value=outdated,
        image_action="preserve",
    )

    assert response["ok"] is True
    context = lens.context()
    references = cast(dict[str, Any], context.references)
    assert references["selections"][0]["snapshot"] == {"status": "outdated"}
    assert references["selections"][0]["anchor"]["x"] == 0.5
    assert context.images["selection-1"] == data


def test_every_mutation_rejects_stale_revision_before_changing_state() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())

    stale_put = _put(
        lens,
        revision=0,
        selection_value=copy.deepcopy(_selections(lens)[0]),
        image_action="preserve",
    )
    stale_activate = _activate(lens, revision=0, selection_id="selection-1")
    stale_delete = _delete(lens, revision=0, selection_id="selection-1")
    stale_clear = _clear(lens, revision=0)

    assert stale_put["error"]["code"] == "revision_conflict"
    assert stale_activate["error"]["code"] == "revision_conflict"
    assert stale_delete["error"]["code"] == "revision_conflict"
    assert stale_clear["error"]["code"] == "revision_conflict"
    assert _state(lens)["revision"] == 1
    assert _state(lens)["currentSelectionId"] == "selection-1"


def test_trait_publish_failure_rolls_back_selection_current_mru_and_image() -> None:
    lens = FailingPublishLens()
    data = png()
    lens.fail_next_state_publish = True

    failed_put = _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )

    assert failed_put["error"]["code"] == "internal_error"
    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
        "history": [],
    }
    assert lens.context().images == {}

    for index in range(3):
        _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
            ),
        )
    lens.fail_next_state_publish = True
    failed_activate = _activate(lens, revision=3, selection_id="selection-1")
    assert failed_activate["error"]["code"] == "internal_error"
    assert _state(lens)["currentSelectionId"] == "selection-3"

    _delete(lens, revision=3, selection_id="selection-3")
    assert _state(lens)["currentSelectionId"] == "selection-2"


def test_snapshot_get_returns_the_exact_stored_png() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        data=data,
        image_action="replace",
    )

    _send(lens, "snapshot.get", {"selectionId": "selection-1"})
    response, buffers = lens.sent[-1]

    assert response["ok"] is True
    assert response["version"] == 4
    assert response["payload"]["selectionId"] == "selection-1"
    assert (
        response["payload"]["snapshot"]["sha256"] == snapshot_metadata(data)["sha256"]
    )
    assert buffers == [data]


def _put(
    lens: RecordingLens,
    *,
    revision: int,
    selection_value: dict[str, Any],
    data: bytes | None = None,
    image_action: str = "clear",
) -> dict[str, Any]:
    buffers = [data] if image_action == "replace" and data is not None else []
    _send(
        lens,
        "selection.put",
        {
            "selection": selection_value,
            "expectedRevision": revision,
            "imageAction": image_action,
        },
        buffers=buffers,
    )
    return lens.sent[-1][0]


def _activate(
    lens: RecordingLens,
    *,
    revision: int,
    selection_id: str,
) -> dict[str, Any]:
    _send(
        lens,
        "selection.activate",
        {"selectionId": selection_id, "expectedRevision": revision},
    )
    return lens.sent[-1][0]


def _delete(
    lens: RecordingLens,
    *,
    revision: int,
    selection_id: str,
) -> dict[str, Any]:
    _send(
        lens,
        "selection.delete",
        {"selectionId": selection_id, "expectedRevision": revision},
    )
    return lens.sent[-1][0]


def _clear(lens: RecordingLens, *, revision: int) -> dict[str, Any]:
    _send(lens, "selections.clear", {"expectedRevision": revision})
    return lens.sent[-1][0]


def _reopen(
    lens: RecordingLens,
    *,
    revision: int,
    selection_id: str,
    resolution_revision: int,
) -> dict[str, Any]:
    _send(
        lens,
        "selection.reopen",
        {
            "selectionId": selection_id,
            "resolutionRevision": resolution_revision,
            "expectedRevision": revision,
        },
    )
    return lens.sent[-1][0]


def _clear_history(lens: RecordingLens, *, revision: int) -> dict[str, Any]:
    _send(lens, "history.clear", {"expectedRevision": revision})
    return lens.sent[-1][0]


def _send(
    lens: RecordingLens,
    command_type: str,
    payload: dict[str, Any],
    *,
    buffers: Sequence[bytes] = (),
) -> None:
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.command",
            "version": 4,
            "requestId": f"request-{len(lens.sent) + 1}",
            "type": command_type,
            "payload": payload,
        },
        list(buffers),
    )


def _state(lens: RecordingLens) -> dict[str, Any]:
    return cast(dict[str, Any], lens._state)


def _selections(lens: RecordingLens) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], _state(lens)["selections"])
