from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from typing import Any, ClassVar, cast

import pytest
from marimo_lens import Lens, LensError

from tests.support.factories import png, selection


class RecordingLens(Lens):
    sent: list[tuple[dict[str, Any], list[bytes]]]

    def __init__(self, *, browser_ready: bool = True) -> None:
        self.sent = []
        super().__init__()
        if browser_ready:
            _set_browser_ready(self, True)

    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        self.sent.append((content, [bytes(buffer) for buffer in buffers or []]))


class FailingCaptureLens(RecordingLens):
    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        if content.get("type") == "output.capture":
            raise RuntimeError("browser disconnected")
        super().send(content, buffers)


class ManualTimer:
    instances: ClassVar[list[ManualTimer]] = []

    def __init__(
        self,
        interval: float,
        function: Callable[..., object],
        args: tuple[object, ...] | None = None,
        kwargs: dict[str, object] | None = None,
    ) -> None:
        self.interval = interval
        self.function = function
        self.args = args or ()
        self.kwargs = kwargs or {}
        self.daemon = False
        self.started = False
        self.cancelled = False
        self.instances.append(self)

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.cancelled = True

    def fire(self) -> None:
        if self.started and not self.cancelled:
            self.function(*self.args, **self.kwargs)


def test_start_returns_one_opaque_pending_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()

    request_id = lens._start_output_capture("cell-view", expected_revision=0)
    result = lens._read_output_capture(request_id)

    assert result.request_id == request_id
    assert result.cell_id == "cell-view"
    assert result.selection_ids == ()
    assert result.status == "pending"
    assert result.image is None
    assert result.error_code is None
    assert result.error is None
    assert _capture_commands(lens) == [
        {
            "protocol": "marimo-lens.command",
            "version": 1,
            "requestId": request_id,
            "type": "output.capture",
            "payload": {"outputCellId": "cell-view", "selections": []},
        }
    ]
    assert lens.context().revision == 0


def test_capture_includes_every_open_selection_for_the_requested_cell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    _put_selection(lens, selection(), revision=0)
    second = selection(selection_id="selection-2", label="S2")
    second["anchor"] = {
        "kind": "rect",
        "x": 0.1,
        "y": 0.2,
        "width": 0.3,
        "height": 0.4,
    }
    _put_selection(lens, second, revision=1)
    _put_selection(
        lens,
        selection(
            selection_id="selection-3",
            label="S3",
            output_cell_id="cell-other",
        ),
        revision=2,
    )

    request_id = lens._start_output_capture("cell-view", expected_revision=3)
    command = _capture_commands(lens)[0]
    result = lens._read_output_capture(request_id)

    assert command["payload"]["selections"] == [
        {
            "selectionId": "selection-1",
            "label": "S1",
            "anchor": {"kind": "point", "x": 0.25, "y": 0.75},
        },
        {
            "selectionId": "selection-2",
            "label": "S2",
            "anchor": {
                "kind": "rect",
                "x": 0.1,
                "y": 0.2,
                "width": 0.3,
                "height": 0.4,
            },
        },
    ]
    assert result.selection_ids == ("selection-1", "selection-2")


def test_revision_change_during_runtime_check_rejects_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    lens: RecordingLens

    def change_selection(
        _runtime: MarimoRuntimeAdapter,
        _cell_id: str,
    ) -> str:
        _put_selection(
            lens,
            selection(selection_id="selection-2", label="S2"),
            revision=1,
        )
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", change_selection)
    lens = RecordingLens()
    _put_selection(lens, selection(), revision=0)

    with pytest.raises(LensError) as raised:
        lens._start_output_capture("cell-view", expected_revision=1)

    assert raised.value.code == "revision_conflict"
    assert raised.value.revision == 2
    assert _capture_commands(lens) == []


def test_successful_read_consumes_the_transferred_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)
    command = _capture_commands(lens)[0]
    data = png(3, 2)

    _reply(lens, command, data=data, width=3, height=2)
    result = lens._read_output_capture(request_id)

    assert result.status == "available"
    assert result.image is not None
    assert result.image.request_id == request_id
    assert result.image.cell_id == "cell-view"
    assert result.image.data == data
    assert result.image.sha256 == hashlib.sha256(data).hexdigest()
    with pytest.raises(LensError) as raised:
        lens._read_output_capture(request_id)
    assert raised.value.code == "capture_expired"


@pytest.mark.parametrize(
    ("browser_code", "result_code"),
    [
        ("output_unavailable", "output_unavailable"),
        ("browser_unavailable", "browser_unavailable"),
        ("capture_timeout", "capture_timeout"),
        ("implementation_detail", "capture_failed"),
    ],
)
def test_failed_read_consumes_one_bounded_failure(
    monkeypatch: pytest.MonkeyPatch,
    browser_code: str,
    result_code: str,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)

    _fail_reply(
        lens,
        _capture_commands(lens)[0],
        code=browser_code,
        message="The cell output cannot be captured.",
    )
    result = lens._read_output_capture(request_id)

    assert result.status == "failed"
    assert result.error_code == result_code
    assert result.error == "The cell output cannot be captured."
    assert result.image is None
    with pytest.raises(LensError) as raised:
        lens._read_output_capture(request_id)
    assert raised.value.code == "capture_expired"


def test_pending_capture_rejects_another_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    first = lens._start_output_capture("cell-view", expected_revision=0)

    with pytest.raises(LensError) as raised:
        lens._start_output_capture("cell-other", expected_revision=0)

    assert raised.value.code == "capture_busy"
    assert lens._read_output_capture(first).status == "pending"
    assert len(_capture_commands(lens)) == 1


def test_new_start_replaces_an_unconsumed_terminal_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    first = lens._start_output_capture("cell-view", expected_revision=0)
    _fail_reply(
        lens,
        _capture_commands(lens)[0],
        code="capture_failed",
        message="First failed.",
    )

    second = lens._start_output_capture("cell-other", expected_revision=0)

    assert second != first
    with pytest.raises(LensError) as raised:
        lens._read_output_capture(first)
    assert raised.value.code == "capture_expired"
    assert lens._read_output_capture(second).status == "pending"
    assert [
        command["payload"]["outputCellId"] for command in _capture_commands(lens)
    ] == [
        "cell-view",
        "cell-other",
    ]


def test_browser_unready_fails_an_active_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)

    _set_browser_ready(lens, False)
    result = lens._read_output_capture(request_id)

    assert result.status == "failed"
    assert result.error_code == "browser_unavailable"


def test_deadline_fails_capture_and_ignores_late_pixels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._output_capture as capture_module

    ManualTimer.instances = []
    monkeypatch.setattr(capture_module.threading, "Timer", ManualTimer)
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)
    command = _capture_commands(lens)[0]
    timer = ManualTimer.instances[-1]

    timer.fire()
    _reply(lens, command, data=png())
    result = lens._read_output_capture(request_id)

    assert timer.interval == 20.0
    assert result.status == "failed"
    assert result.error_code == "capture_timeout"


def test_wrong_cell_or_invalid_png_becomes_a_terminal_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)

    _reply(lens, _capture_commands(lens)[0], data=png(), cell_id="cell-other")
    result = lens._read_output_capture(request_id)

    assert result.status == "failed"
    assert result.error_code == "capture_failed"
    assert result.image is None


def test_unrelated_response_does_not_change_the_active_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)
    command = dict(_capture_commands(lens)[0])
    command["requestId"] = "another-request"

    _reply(lens, command, data=png())

    assert lens._read_output_capture(request_id).status == "pending"


@pytest.mark.parametrize(
    ("runtime_status", "code"),
    [("missing", "cell_not_found"), ("unavailable", "runtime_unavailable")],
)
def test_start_requires_an_exact_runtime_cell(
    monkeypatch: pytest.MonkeyPatch,
    runtime_status: str,
    code: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: runtime_status,
    )
    lens = RecordingLens()

    with pytest.raises(LensError) as raised:
        lens._start_output_capture("cell-view", expected_revision=0)

    assert raised.value.code == code
    assert _capture_commands(lens) == []


def test_start_requires_a_displayed_capture_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens(browser_ready=False)

    with pytest.raises(LensError) as raised:
        lens._start_output_capture("cell-view", expected_revision=0)

    assert raised.value.code == "browser_unavailable"


def test_send_failure_is_read_as_a_terminal_capture_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = FailingCaptureLens()

    request_id = lens._start_output_capture("cell-view", expected_revision=0)
    result = lens._read_output_capture(request_id)

    assert result.status == "failed"
    assert result.error_code == "capture_failed"


def test_close_releases_the_mailbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    request_id = lens._start_output_capture("cell-view", expected_revision=0)

    lens.close()

    with pytest.raises(LensError) as read_error:
        lens._read_output_capture(request_id)
    assert read_error.value.code == "lens_closed"
    with pytest.raises(LensError) as start_error:
        lens._start_output_capture("cell-view", expected_revision=0)
    assert start_error.value.code == "lens_closed"


@pytest.mark.parametrize(
    ("method", "value", "error_type", "message"),
    [
        ("start", 1, TypeError, "cell_id must be a string"),
        ("start", "", ValueError, "cell_id must not be empty"),
        ("start", "x" * 129, ValueError, "at most 128 UTF-16 code units"),
        ("read", 1, TypeError, "request_id must be a string"),
        ("read", "", ValueError, "request_id must not be empty"),
        ("read", "x" * 257, ValueError, "at most 256 UTF-16 code units"),
    ],
)
def test_private_agent_boundary_validates_identifiers(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    value: object,
    error_type: type[Exception],
    message: str,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()

    with pytest.raises(error_type, match=message):
        if method == "start":
            lens._start_output_capture(cast(Any, value), expected_revision=0)
        else:
            lens._read_output_capture(cast(Any, value))


def _install_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *cell_ids: str,
) -> None:
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    available = cell_ids or ("cell-view",)
    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, cell_id: "available" if cell_id in available else "missing",
    )


def _capture_commands(lens: RecordingLens) -> list[dict[str, Any]]:
    return [
        content
        for content, _buffers in lens.sent
        if content.get("type") == "output.capture"
    ]


def _put_selection(
    lens: RecordingLens,
    value: dict[str, Any],
    *,
    revision: int,
) -> None:
    lens._handle_lens_message(
        lens,
        {
            "protocol": "marimo-lens.command",
            "version": 1,
            "requestId": f"put-{revision}",
            "type": "selection.put",
            "payload": {
                "selection": value,
                "imageAction": "clear",
                "expectedRevision": revision,
            },
        },
        (),
    )


def _set_browser_ready(lens: RecordingLens, ready: bool) -> None:
    lens._handle_lens_message(
        lens,
        {
            "protocol": "marimo-lens.event",
            "version": 1,
            "type": f"output.capture.{'ready' if ready else 'unready'}",
            "payload": {},
        },
        (),
    )


def _reply(
    lens: RecordingLens,
    command: Mapping[str, Any],
    *,
    data: bytes,
    width: int = 2,
    height: int = 2,
    cell_id: str | None = None,
) -> None:
    payload = command["payload"]
    assert isinstance(payload, Mapping)
    lens._handle_lens_message(
        lens,
        {
            "protocol": "marimo-lens.response",
            "version": 1,
            "requestId": command["requestId"],
            "ok": True,
            "revision": 0,
            "payload": {
                "outputCellId": payload["outputCellId"] if cell_id is None else cell_id,
                "image": {
                    "status": "available",
                    "id": f"image:{command['requestId']}",
                    "mediaType": "image/png",
                    "width": width,
                    "height": height,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "capturedAt": "2026-07-18T12:00:00Z",
                },
            },
        },
        [data],
    )


def _fail_reply(
    lens: RecordingLens,
    command: Mapping[str, Any],
    *,
    code: str,
    message: str,
) -> None:
    payload = command["payload"]
    assert isinstance(payload, Mapping)
    lens._handle_lens_message(
        lens,
        {
            "protocol": "marimo-lens.response",
            "version": 1,
            "requestId": command["requestId"],
            "ok": False,
            "revision": 0,
            "payload": {"outputCellId": payload["outputCellId"]},
            "error": {"code": code, "message": message},
        },
        [],
    )
