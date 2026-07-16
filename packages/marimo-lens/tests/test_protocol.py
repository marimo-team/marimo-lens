from __future__ import annotations

import pytest

from marimo_lens._protocol import (
    ProtocolError,
    error_response,
    parse_command,
    request_id_from,
    success_response,
)

from tests.support.factories import png, selection, snapshot_metadata


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


def test_activate_delete_clear_export_and_snapshot_use_object_payloads() -> None:
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
    export = parse_command(_command("context.export", {"format": "current"}), [])
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
    assert export is not None
    assert export.payload == {"format": "current"}
    assert snapshot is not None
    assert snapshot.payload == {"selectionId": "selection-1"}


def test_command_ignores_envelopes_owned_by_bundle_transport() -> None:
    assert parse_command({"type": "anywidget-bundle:request"}, []) is None


@pytest.mark.parametrize(
    ("updates", "code"),
    [
        ({"version": 2}, "unsupported_version"),
        ({"version": True}, "unsupported_version"),
        ({"type": "selection.unknown"}, "unsupported_command"),
        ({"unexpected": True}, "invalid_request"),
    ],
)
def test_command_rejects_protocol_drift(
    updates: dict[str, object],
    code: str,
) -> None:
    content = _command("context.export", {"format": "text"})
    content.update(updates)

    with pytest.raises(ProtocolError) as raised:
        parse_command(content, [])

    assert raised.value.code == code


def test_context_export_rejects_unknown_format() -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_command(_command("context.export", {"format": "verbose"}), [])

    assert raised.value.code == "invalid_export_format"


def test_put_requires_expected_revision_and_matching_buffer_action() -> None:
    data = png()
    content = _command(
        "selection.put",
        {
            "selection": selection(snapshot=snapshot_metadata(data)),
            "imageAction": "replace",
        },
    )

    with pytest.raises(ProtocolError, match="fields"):
        parse_command(content, [data])

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
    with pytest.raises(ProtocolError, match="pending, available, failed, or outdated"):
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

    with pytest.raises(ProtocolError, match="inside"):
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


def test_selection_rejects_numbers_too_large_for_browser_coordinates() -> None:
    value = selection()
    value["anchor"] = {"kind": "point", "x": 10**10_000, "y": 0.5}

    with pytest.raises(ProtocolError, match="finite"):
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

    with pytest.raises(ProtocolError, match="4000"):
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


def test_strings_reject_unpaired_utf16_surrogates() -> None:
    value = selection(note="broken \ud800 text")

    with pytest.raises(ProtocolError, match="valid Unicode"):
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
