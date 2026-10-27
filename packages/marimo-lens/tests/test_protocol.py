from __future__ import annotations

import hashlib
from typing import Any

import pytest
from marimo_lens._protocol.codec import (
    ProtocolError,
    capture_command,
    error_response,
    parse_capture_response,
    parse_command,
    request_id_from,
)
from marimo_lens._protocol.messages import PROTOCOL_VERSION
from marimo_lens._schema.model import dump_model

from tests.support.factories import png, selection, snapshot_metadata

DATA = png()
IMAGE = snapshot_metadata(DATA)


def _command(command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol": "marimo-lens.command",
        "version": PROTOCOL_VERSION,
        "requestId": "request-1",
        "type": command_type,
        "payload": payload,
    }


def _put(
    value: dict[str, Any], *, image_action: str = "clear", revision: int = 0
) -> dict[str, Any]:
    return {
        "selection": value,
        "expectedRevision": revision,
        "imageAction": image_action,
    }


def _with(**fields: Any) -> dict[str, Any]:
    return {**selection(), **fields}


def _activate(**fields: Any) -> dict[str, Any]:
    return _command(
        "selection.activate",
        {"selectionId": "selection-1", "expectedRevision": 0, **fields},
    )


def _without(content: dict[str, Any], field: str) -> dict[str, Any]:
    return {key: value for key, value in content.items() if key != field}


@pytest.mark.parametrize(
    ("command_type", "payload", "buffers"),
    [
        pytest.param("selection.put", _put(selection(note="")), [], id="no-note"),
        pytest.param(
            "selection.put",
            _put(selection(snapshot=IMAGE), image_action="replace"),
            [DATA],
            id="png",
        ),
        pytest.param(
            "selection.put",
            _put(
                selection(
                    snapshot={
                        "status": "failed",
                        "capturedAt": "2026-07-14T11:58:00Z",
                        "error": "External frame cannot be captured",
                    }
                )
            ),
            [],
            id="failed-capture",
        ),
        pytest.param(
            "selection.put",
            _put(
                selection(snapshot={**IMAGE, "status": "outdated"}),
                image_action="preserve",
                revision=1,
            ),
            [],
            id="outdated-without-png",
        ),
        pytest.param(
            "selection.put",
            _put(
                _with(
                    anchor={
                        "kind": "rect",
                        "x": 0,
                        "y": 0,
                        "width": 1e-20,
                        "height": 1e-20,
                    }
                )
            ),
            [],
            id="subnormal-rect",
        ),
        pytest.param(
            "selection.put",
            _put(
                _with(
                    anchor={
                        "kind": "point",
                        "x": 0.25,
                        "y": 0.5,
                        "frame": {
                            "path": "div > canvas",
                            "bounds": {"x": 0, "y": 0, "width": 0.5, "height": 1},
                        },
                    }
                )
            ),
            [],
            id="framed-anchor",
        ),
        pytest.param(
            "selection.activate",
            {"selectionId": "selection-1", "expectedRevision": 2},
            [],
            id="activate",
        ),
        pytest.param(
            "selection.delete",
            {"selectionId": "selection-1", "expectedRevision": 3},
            [],
            id="delete",
        ),
        pytest.param("selections.clear", {"expectedRevision": 4}, [], id="clear"),
        pytest.param(
            "selection.reopen",
            {
                "selectionId": "selection-1",
                "resolvedAt": "2026-10-21T10:01:00+00:00",
                "documentId": "document-2",
                "documentPath": "/",
                "expectedRevision": 5,
            },
            [],
            id="reopen",
        ),
        pytest.param("history.refresh", {}, [], id="history-refresh"),
        pytest.param("history.image", {"sha256": "a" * 64}, [], id="history-image"),
        pytest.param(
            "snapshot.get", {"selectionId": "selection-1"}, [], id="snapshot-get"
        ),
    ],
)
def test_parse_command_accepts_each_supported_payload(
    command_type: str, payload: dict[str, Any], buffers: list[bytes]
) -> None:
    command = parse_command(_command(command_type, payload), buffers)

    assert command is not None
    assert (command.request_id, command.type) == ("request-1", command_type)
    assert dump_model(command.payload) == payload


@pytest.mark.parametrize(
    ("content", "buffers", "code"),
    [
        pytest.param(
            _command("selection.put", _put(selection(selection_id="   "))),
            [],
            "invalid_request",
            id="blank-selection-id",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(
                    selection(
                        target={
                            "kind": "notebook",
                            "cellIds": ["   "],
                            "documentId": "document-1",
                            "documentPath": "/",
                        }
                    )
                ),
            ),
            [],
            "invalid_request",
            id="blank-cell-id",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(
                    selection(
                        target={
                            "kind": "dom",
                            "sources": [{"cellId": "another-cell", "selector": "rich"}],
                            "cellIds": ["cell-a"],
                            "documentId": "document-1",
                            "documentPath": "/",
                            "domSelector": "#forecast-summary",
                        }
                    )
                ),
            ),
            [],
            "invalid_request",
            id="source-outside-cells",
        ),
        pytest.param(
            _command(
                "selection.put",
                {"selection": selection(snapshot=IMAGE), "imageAction": "replace"},
            ),
            [DATA],
            "invalid_request",
            id="missing-revision",
        ),
        pytest.param(
            _command(
                "selection.put", _put(selection(snapshot=IMAGE), image_action="replace")
            ),
            [],
            "invalid_buffers",
            id="replace-without-png",
        ),
        pytest.param(
            _command("selection.put", _put(selection(snapshot={"status": "missing"}))),
            [],
            "invalid_image",
            id="unknown-snapshot-status",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(
                    selection(snapshot={**IMAGE, "id": "image:S1"}),
                    image_action="replace",
                ),
            ),
            [DATA],
            "invalid_image",
            id="image-id-of-another-selection",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(
                    _with(
                        anchor={
                            "kind": "rect",
                            "x": 0.8,
                            "y": 0.2,
                            "width": 0.3,
                            "height": 0.4,
                        }
                    )
                ),
            ),
            [],
            "invalid_selection",
            id="rect-outside-output",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(_with(anchor={"kind": "point", "x": 10**10_000, "y": 0.5})),
            ),
            [],
            "invalid_selection",
            id="number-too-large-for-browser",
        ),
        pytest.param(
            _command(
                "selection.put",
                _put(
                    _with(
                        description={
                            "label": "Square",
                            "media": {
                                "path": "animation.mp4",
                                "start": 4.0,
                                "end": 3.2,
                            },
                        }
                    )
                ),
            ),
            [],
            "invalid_selection",
            id="media-ends-before-start",
        ),
        pytest.param(
            _command("selection.put", _put(selection(note="🙂" * 2_001))),
            [],
            "invalid_request",
            id="note-over-utf16-bound",
        ),
        pytest.param(
            _command("selection.put", _put(selection(note="broken \ud800 text"))),
            [],
            "invalid_request",
            id="unpaired-surrogate",
        ),
        *(
            pytest.param(
                _command("selection.put", _put(_with(createdAt=created_at))),
                [],
                "invalid_request",
                id=f"timestamp-{index}",
            )
            for index, created_at in enumerate(
                [
                    "2026-07-20T10:01:00+00:60",
                    "2026-07-20T10:01:00+24:00",
                    "2026-07-20 10:01:00Z",
                ]
            )
        ),
        *(
            pytest.param(
                _activate(selectionId=blank),
                [],
                "invalid_request",
                id=f"browser-blank-{index}",
            )
            for index, blank in enumerate(["\u0085", "\ufeff", "\x1c"])
        ),
        pytest.param(
            _activate(selectionId="\ud800"),
            [],
            "invalid_request",
            id="identifier-unpaired-surrogate",
        ),
        *(
            pytest.param(
                _activate(expectedRevision=revision),
                [],
                "invalid_request",
                id=f"revision-{revision!r}",
            )
            for revision in [True, -1, 1.0, 9_007_199_254_740_992]
        ),
        *(
            pytest.param(
                _without(_activate(), field),
                [],
                "invalid_request",
                id=f"missing-{field}",
            )
            for field in ["version", "requestId", "type", "payload"]
        ),
        *(
            pytest.param(
                {**_activate(), "version": version},
                [],
                "unsupported_version",
                id=f"version-{version!r}",
            )
            for version in [PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1, True]
        ),
        pytest.param(
            {**_activate(), "type": "selection.unknown"},
            [],
            "unsupported_command",
            id="unknown-command",
        ),
        pytest.param(
            _command("history.image", {"sha256": "../../secrets"}),
            [],
            "invalid_request",
            id="image-digest-path",
        ),
    ],
)
def test_parse_command_rejects_each_invalid_message(
    content: dict[str, Any], buffers: list[bytes], code: str
) -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_command(content, buffers)

    assert raised.value.code == code


def test_command_ignores_unrelated_envelopes() -> None:
    assert parse_command({"type": "host.status"}, []) is None


def test_command_projects_supported_fields_from_additive_messages() -> None:
    value = selection()
    value["sourceRevision"] = 7
    value["anchor"]["pixelRatio"] = 2
    content = _command("selection.put", {**_put(value), "trace": "browser"})
    content["trace"] = "browser"

    command = parse_command(content, [])

    assert command is not None
    assert dump_model(command.payload) == _put(selection())


def test_dom_targets_list_their_cells_in_one_order() -> None:
    target: dict[str, object] = {
        "kind": "dom",
        "sources": [
            {"cellId": "cell-a", "selector": None},
            {"cellId": "cell-b", "selector": "rich"},
        ],
        "cellIds": ["cell-b", "cell-a"],
        "documentId": "document-1",
        "documentPath": "/dashboard/",
        "domSelector": "#forecast-summary",
    }

    command = parse_command(
        _command("selection.put", _put(selection(target=target))), []
    )

    assert command is not None
    assert dump_model(command.payload)["selection"]["target"] == {
        **target,
        "cellIds": ["cell-a", "cell-b"],
    }


def test_output_capture_uses_a_separate_outgoing_command_path() -> None:
    command = capture_command(request_id="request-1", cell_id="cell-view")

    assert command == {
        "protocol": "marimo-lens.command",
        "version": PROTOCOL_VERSION,
        "requestId": "request-1",
        "type": "output.capture",
        "payload": {"outputCellId": "cell-view"},
    }
    with pytest.raises(ProtocolError) as raised:
        parse_command(command, [])
    assert raised.value.code == "unsupported_command"


def _capture_response(*, ok: bool, **payload: Any) -> dict[str, Any]:
    return {
        "protocol": "marimo-lens.response",
        "version": PROTOCOL_VERSION,
        "requestId": "request-1",
        "ok": ok,
        "revision": 4,
        "payload": {"outputCellId": "cell-view", **payload},
    }


def _captured_image(image_id: str) -> dict[str, Any]:
    return {
        "status": "available",
        "id": image_id,
        "mediaType": "image/png",
        "width": 2,
        "height": 2,
        "sha256": hashlib.sha256(DATA).hexdigest(),
        "capturedAt": "2026-07-18T12:00:00Z",
    }


def test_output_capture_response_requires_metadata_and_one_png() -> None:
    response = parse_capture_response(
        _capture_response(ok=True, image=_captured_image("image:request-1")), [DATA]
    )

    assert response.cell_id == "cell-view"
    assert response.image is not None
    assert response.error_code is None


def test_output_capture_response_rejects_image_for_another_request() -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_capture_response(
            _capture_response(ok=True, image=_captured_image("image:request-2")),
            [DATA],
        )

    assert raised.value.code == "invalid_image"


def test_output_capture_failure_rejects_binary_buffers() -> None:
    failure = {
        **_capture_response(ok=False),
        "error": {"code": "capture_failed", "message": "Capture failed."},
    }

    with pytest.raises(ProtocolError) as raised:
        parse_capture_response(failure, [DATA])

    assert raised.value.code == "invalid_buffers"


def test_output_capture_response_accepts_additive_fields() -> None:
    response = parse_capture_response(
        {
            **_capture_response(ok=False, trace="browser"),
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


@pytest.mark.parametrize(
    "request_id",
    ["r" * 1_000_000, "broken\ud800id"],
    ids=["oversized", "unpaired-surrogate"],
)
def test_invalid_request_id_is_not_echoed(request_id: str) -> None:
    assert request_id_from({"requestId": request_id}) is None
