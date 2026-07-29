from __future__ import annotations

import hashlib

import pytest
from marimo_lens._protocol import (
    ProtocolError,
    capture_command,
    cell_activity_event,
    cell_reveal_event,
    error_response,
    mutation_ack_response,
    parse_capture_response,
    parse_command,
    request_id_from,
    selection_put_response,
    selection_resolved_event,
    snapshot_response,
    success_response,
)
from marimo_lens._protocol import (
    snapshot_metadata as build_snapshot_metadata,
)
from marimo_lens.context import SelectionImage

from tests.support.factories import png, selection, snapshot_metadata


def test_cell_reveal_event_uses_transient_transport() -> None:
    assert cell_reveal_event(
        cell_id="cell-view",
        message="Updated the aggregation.",
        duration_ms=8_000,
        revision=3,
    ) == {
        "protocol": "marimo-lens.event",
        "version": 1,
        "type": "cell.reveal",
        "revision": 3,
        "payload": {
            "cellId": "cell-view",
            "message": "Updated the aggregation.",
            "durationMs": 8_000,
        },
    }


def test_cell_reveal_event_omits_an_absent_message() -> None:
    assert cell_reveal_event(
        cell_id="cell-view",
        message=None,
        revision=0,
    )["payload"] == {"cellId": "cell-view"}


def test_cell_activity_event_uses_transient_transport() -> None:
    assert cell_activity_event(
        cell_id="cell-view",
        label="On it",
        message="Updating the aggregation.",
        revision=3,
    ) == {
        "protocol": "marimo-lens.event",
        "version": 1,
        "type": "cell.activity",
        "revision": 3,
        "payload": {
            "cellId": "cell-view",
            "label": "On it",
            "message": "Updating the aggregation.",
        },
    }


def test_selection_resolved_event_carries_one_atomic_batch() -> None:
    assert selection_resolved_event(
        selections=[
            {
                "selectionId": "selection-1",
                "label": "S1",
                "resolutionRevision": 4,
            },
            {
                "selectionId": "selection-2",
                "label": "S2",
                "resolutionRevision": 4,
            },
        ],
        summary="Updated and verified both requests.",
        revision=4,
    )["payload"] == {
        "selections": [
            {
                "selectionId": "selection-1",
                "label": "S1",
                "resolutionRevision": 4,
            },
            {
                "selectionId": "selection-2",
                "label": "S2",
                "resolutionRevision": 4,
            },
        ],
        "summary": "Updated and verified both requests.",
    }


def test_put_command_parses_immediate_selection_without_a_note() -> None:
    command = parse_command(
        _command(
            "selection.put",
            {
                "selection": selection(note="", snapshot={"status": "pending"}),
                "expectedRevision": 0,
                "imageAction": "clear",
            },
        ),
        [],
    )

    assert command is not None
    assert command.request_id == "request-1"
    assert command.type == "selection.put"
    assert command.payload["expectedRevision"] == 0
    assert command.payload["selection"]["note"] == ""
    assert command.payload["selection"]["anchor"] == {
        "kind": "point",
        "x": 0.25,
        "y": 0.75,
    }


def test_put_command_parses_complete_selection_and_png_buffer() -> None:
    data = png()
    command = parse_command(
        _command(
            "selection.put",
            {
                "selection": selection(snapshot=snapshot_metadata(data)),
                "expectedRevision": 0,
                "imageAction": "replace",
            },
        ),
        [data],
    )

    assert command is not None
    assert command.payload["selection"]["snapshot"]["status"] == "available"


def test_mutations_and_snapshot_use_object_payloads() -> None:
    activate = parse_command(
        _command(
            "selection.activate",
            {"selectionId": "selection-1", "expectedRevision": 2},
        ),
        [],
    )
    delete = parse_command(
        _command(
            "selection.delete",
            {"selectionId": "selection-1", "expectedRevision": 3},
        ),
        [],
    )
    clear = parse_command(_command("selections.clear", {"expectedRevision": 4}), [])
    reopen = parse_command(
        _command(
            "selection.reopen",
            {
                "selectionId": "selection-1",
                "resolutionRevision": 5,
                "expectedRevision": 5,
            },
        ),
        [],
    )
    clear_history = parse_command(
        _command("history.clear", {"expectedRevision": 6}),
        [],
    )
    snapshot = parse_command(
        _command("snapshot.get", {"selectionId": "selection-1"}), []
    )

    assert activate is not None
    assert activate.payload == {
        "selectionId": "selection-1",
        "expectedRevision": 2,
    }
    assert delete is not None
    assert delete.payload == {
        "selectionId": "selection-1",
        "expectedRevision": 3,
    }
    assert clear is not None
    assert clear.payload == {"expectedRevision": 4}
    assert reopen is not None
    assert reopen.payload == {
        "selectionId": "selection-1",
        "resolutionRevision": 5,
        "expectedRevision": 5,
    }
    assert clear_history is not None
    assert clear_history.payload == {"expectedRevision": 6}
    assert snapshot is not None
    assert snapshot.payload == {"selectionId": "selection-1"}


def test_command_ignores_unrelated_envelopes() -> None:
    assert parse_command({"type": "host.status"}, []) is None


@pytest.mark.parametrize(
    ("updates", "code"),
    [
        ({"version": 2}, "unsupported_version"),
        ({"version": True}, "unsupported_version"),
        ({"type": "selection.unknown"}, "unsupported_command"),
    ],
)
def test_command_rejects_incompatible_transport(
    updates: dict[str, object],
    code: str,
) -> None:
    content = _command(
        "selection.activate",
        {"selectionId": "selection-1", "expectedRevision": 0},
    )
    content.update(updates)

    with pytest.raises(ProtocolError) as raised:
        parse_command(content, [])

    assert raised.value.code == code


def test_command_projects_supported_fields_from_additive_messages() -> None:
    value = selection(snapshot={"status": "pending"})
    value["sourceRevision"] = 7
    value["anchor"]["pixelRatio"] = 2
    content = _command(
        "selection.put",
        {
            "selection": value,
            "expectedRevision": 0,
            "imageAction": "clear",
            "trace": "browser",
        },
    )
    content["trace"] = "browser"

    command = parse_command(content, [])

    assert command is not None
    assert command.payload == {
        "selection": selection(snapshot={"status": "pending"}),
        "expectedRevision": 0,
        "imageAction": "clear",
    }


@pytest.mark.parametrize("field", ["version", "requestId", "type", "payload"])
def test_command_requires_transport_fields(field: str) -> None:
    content = _command(
        "selection.activate",
        {"selectionId": "selection-1", "expectedRevision": 0},
    )
    content.pop(field)

    with pytest.raises(ProtocolError) as raised:
        parse_command(content, [])

    assert raised.value.code == "invalid_request"


@pytest.mark.parametrize("revision", [True, -1, 1.0, 9_007_199_254_740_992])
def test_commands_reject_revisions_outside_the_json_safe_integer_contract(
    revision: object,
) -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.activate",
                {
                    "selectionId": "selection-1",
                    "expectedRevision": revision,
                },
            ),
            [],
        )

    assert raised.value.code == "invalid_request"


@pytest.mark.parametrize(
    "field",
    ["id", "outputCellId"],
)
def test_selection_commands_reject_whitespace_only_identifiers(field: str) -> None:
    value = selection()
    value[field] = "   "

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )

    assert raised.value.code == "invalid_request"


def test_put_requires_expected_revision_and_matching_buffer_action() -> None:
    data = png()
    content = _command(
        "selection.put",
        {
            "selection": selection(snapshot=snapshot_metadata(data)),
            "imageAction": "replace",
        },
    )

    with pytest.raises(ProtocolError) as missing_revision:
        parse_command(content, [data])
    assert missing_revision.value.code == "invalid_request"

    content = _command(
        "selection.put",
        {
            "selection": selection(snapshot=snapshot_metadata(data)),
            "expectedRevision": 0,
            "imageAction": "replace",
        },
    )
    with pytest.raises(ProtocolError) as raised:
        parse_command(content, [])
    assert raised.value.code == "invalid_buffers"


@pytest.mark.parametrize(
    ("snapshot", "image_action", "buffers"),
    [
        ({"status": "pending"}, "clear", []),
        (
            {
                "status": "failed",
                "capturedAt": "2026-07-14T11:58:00Z",
                "error": "External frame cannot be captured",
            },
            "clear",
            [],
        ),
    ],
)
def test_zero_buffer_snapshot_states_are_valid(
    snapshot: dict[str, object],
    image_action: str,
    buffers: list[bytes],
) -> None:
    command = parse_command(
        _command(
            "selection.put",
            {
                "selection": selection(snapshot=snapshot),
                "expectedRevision": 0,
                "imageAction": image_action,
            },
        ),
        buffers,
    )

    assert command is not None
    assert command.payload["selection"]["snapshot"]["status"] == snapshot["status"]


def test_missing_snapshot_status_is_rejected() -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": selection(snapshot={"status": "missing"}),
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_image"


def test_outdated_snapshot_is_valid_with_no_new_png_buffer() -> None:
    data = png()
    snapshot = snapshot_metadata(data)
    snapshot["status"] = "outdated"

    command = parse_command(
        _command(
            "selection.put",
            {
                "selection": selection(snapshot=snapshot),
                "expectedRevision": 1,
                "imageAction": "preserve",
            },
        ),
        [],
    )

    assert command is not None
    assert command.payload["selection"]["snapshot"]["status"] == "outdated"


def test_selection_requires_normalized_rect_inside_output() -> None:
    value = selection()
    value["anchor"] = {
        "kind": "rect",
        "x": 0.8,
        "y": 0.2,
        "width": 0.3,
        "height": 0.4,
    }

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_selection"


def test_selection_rejects_numbers_too_large_for_browser_coordinates() -> None:
    value = selection()
    value["anchor"] = {"kind": "point", "x": 10**10_000, "y": 0.5}

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_selection"


def test_available_image_id_is_derived_from_selection_id() -> None:
    data = png()
    value = selection(snapshot=snapshot_metadata(data))
    value["snapshot"]["id"] = "image:S1"

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "replace",
                },
            ),
            [data],
        )

    assert raised.value.code == "invalid_image"


def test_note_limit_matches_browser_utf16_length() -> None:
    value = selection(note="🙂" * 2_001)

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_request"


def test_strings_reject_unpaired_utf16_surrogates() -> None:
    value = selection(note="broken \ud800 text")

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_request"


@pytest.mark.parametrize("blank", ["\u0085", "\ufeff", "\x1c"])
def test_protocol_identifiers_use_the_browser_whitespace_contract(blank: str) -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.activate",
                {"selectionId": blank, "expectedRevision": 0},
            ),
            [],
        )
    assert raised.value.code == "invalid_request"


@pytest.mark.parametrize(
    "created_at",
    [
        "2026-07-20T10:01:00+00:60",
        "2026-07-20T10:01:00+24:00",
        "2026-07-20 10:01:00Z",
    ],
)
def test_timestamps_match_the_browser_offset_contract(created_at: str) -> None:
    value = selection()
    value["createdAt"] = created_at

    with pytest.raises(ProtocolError) as raised:
        parse_command(
            _command(
                "selection.put",
                {
                    "selection": value,
                    "expectedRevision": 0,
                    "imageAction": "clear",
                },
            ),
            [],
        )
    assert raised.value.code == "invalid_request"


def test_positive_subnormal_geometry_is_valid() -> None:
    value = selection()
    value["anchor"] = {
        "kind": "rect",
        "x": 0,
        "y": 0,
        "width": 1e-20,
        "height": 1e-20,
    }

    command = parse_command(
        _command(
            "selection.put",
            {
                "selection": value,
                "expectedRevision": 1,
                "imageAction": "clear",
            },
        ),
        [],
    )

    assert command is not None
    assert command.payload["expectedRevision"] == 1
    assert command.payload["selection"]["anchor"]["width"] == 1e-20


def test_responses_use_version_one_and_include_an_object_payload() -> None:
    success = success_response(request_id="r1", revision=2)
    error = error_response(
        request_id="r2",
        revision=3,
        code="invalid_request",
        message="Bad request.",
    )

    assert success["version"] == 1
    assert success["payload"] == {}
    assert error["version"] == 1
    assert error["payload"] == {}
    assert error["error"] == {
        "code": "invalid_request",
        "message": "Bad request.",
    }


def test_selection_response_builders_own_command_payload_shapes() -> None:
    selected = selection()

    assert mutation_ack_response(
        request_id="activate-1",
        revision=2,
        selection_id="selection-1",
    )["payload"] == {"selectionId": "selection-1"}
    assert (
        mutation_ack_response(
            request_id="clear-1",
            revision=3,
        )["payload"]
        == {}
    )
    assert selection_put_response(
        request_id="put-1",
        revision=1,
        selection=selected,
    )["payload"] == {"selection": selected}


def test_snapshot_response_builder_keeps_metadata_and_png_together() -> None:
    data = png()
    image = SelectionImage(
        id="image:selection-1",
        selection_id="selection-1",
        media_type="image/png",
        data=data,
        width=2,
        height=2,
        sha256=hashlib.sha256(data).hexdigest(),
        captured_at="2026-07-14T11:58:00Z",
        outdated=True,
    )

    response, buffers = snapshot_response(
        request_id="snapshot-1",
        revision=4,
        selection_id="selection-1",
        image=image,
    )

    assert response["payload"] == {
        "selectionId": "selection-1",
        "snapshot": build_snapshot_metadata(image),
    }
    assert response["payload"]["snapshot"]["status"] == "outdated"
    assert buffers == (data,)


def test_output_capture_uses_a_separate_outgoing_command_path() -> None:
    command = capture_command(
        request_id="request-1",
        cell_id="cell-view",
        selections=[
            {
                "selectionId": "selection-1",
                "label": "S1",
                "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
            }
        ],
    )

    assert command == {
        "protocol": "marimo-lens.command",
        "version": 1,
        "requestId": "request-1",
        "type": "output.capture",
        "payload": {
            "outputCellId": "cell-view",
            "selections": [
                {
                    "selectionId": "selection-1",
                    "label": "S1",
                    "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
                }
            ],
        },
    }
    with pytest.raises(ProtocolError) as raised:
        parse_command(command, [])
    assert raised.value.code == "unsupported_command"


def test_output_capture_response_requires_metadata_and_one_png() -> None:
    data = png()
    response = parse_capture_response(
        {
            "protocol": "marimo-lens.response",
            "version": 1,
            "requestId": "request-1",
            "ok": True,
            "revision": 4,
            "payload": {
                "outputCellId": "cell-view",
                "image": {
                    "status": "available",
                    "id": "image:request-1",
                    "mediaType": "image/png",
                    "width": 2,
                    "height": 2,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "capturedAt": "2026-07-18T12:00:00Z",
                },
            },
        },
        [data],
    )

    assert response.cell_id == "cell-view"
    assert response.image is not None
    assert response.error_code is None


def test_output_capture_response_rejects_image_for_another_request() -> None:
    data = png()

    with pytest.raises(ProtocolError) as raised:
        parse_capture_response(
            {
                "protocol": "marimo-lens.response",
                "version": 1,
                "requestId": "request-1",
                "ok": True,
                "revision": 4,
                "payload": {
                    "outputCellId": "cell-view",
                    "image": {
                        "status": "available",
                        "id": "image:request-2",
                        "mediaType": "image/png",
                        "width": 2,
                        "height": 2,
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "capturedAt": "2026-07-18T12:00:00Z",
                    },
                },
            },
            [data],
        )

    assert raised.value.code == "invalid_image"


def test_output_capture_failure_rejects_binary_buffers() -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_capture_response(
            {
                "protocol": "marimo-lens.response",
                "version": 1,
                "requestId": "request-1",
                "ok": False,
                "revision": 4,
                "payload": {"outputCellId": "cell-view"},
                "error": {"code": "capture_failed", "message": "Capture failed."},
            },
            [png()],
        )

    assert raised.value.code == "invalid_buffers"


def test_output_capture_response_accepts_additive_fields() -> None:
    response = parse_capture_response(
        {
            "protocol": "marimo-lens.response",
            "version": 1,
            "requestId": "request-1",
            "ok": False,
            "revision": 4,
            "payload": {
                "outputCellId": "cell-view",
                "trace": "browser",
            },
            "error": {
                "code": "capture_failed",
                "message": "Capture failed.",
                "retryable": False,
            },
            "trace": "browser",
        },
        [],
    )

    assert response.cell_id == "cell-view"
    assert response.image is None
    assert response.error_code == "capture_failed"


def test_error_responses_bound_untrusted_text() -> None:
    error = error_response(
        request_id="r" * 1_000,
        revision=3,
        code="c" * 1_000,
        message="🙂" * 1_000,
    )

    assert len(error["requestId"]) == 256
    assert len(error["error"]["code"]) == 128
    assert len(error["error"]["message"].encode("utf-16-le")) // 2 == 500


@pytest.mark.parametrize("request_id", ["r" * 1_000_000, "broken\ud800id"])
def test_invalid_request_id_is_not_echoed(request_id: str) -> None:
    assert request_id_from({"requestId": request_id}) == ""


def _command(command_type: str, payload: dict[str, object]) -> dict[str, object]:
    return {
        "protocol": "marimo-lens.command",
        "version": 1,
        "requestId": "request-1",
        "type": command_type,
        "payload": payload,
    }
