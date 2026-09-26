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


def test_cell_image_reuses_pending_capture_and_consumes_completed_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    data = png(3, 2)

    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]
    assert lens._cell_image("cell-view", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 1
    assert command["payload"] == {"outputCellId": "cell-view"}

    _reply(lens, command, data=data, width=3, height=2)

    assert lens._cell_image("cell-view", expected_revision=0) == data
    assert lens.context().revision == 0
    assert lens._cell_image("cell-view", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


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
        lens._cell_image("cell-view", expected_revision=1)

    assert raised.value.code == "revision_conflict"
    assert raised.value.revision == 2
    assert _capture_commands(lens) == []


@pytest.mark.parametrize(
    ("browser_code", "error_code"),
    [
        ("output_unavailable", "output_unavailable"),
        ("browser_unavailable", "browser_unavailable"),
        ("capture_timeout", "capture_timeout"),
        ("implementation_detail", "capture_failed"),
    ],
)
def test_cell_image_raises_one_bounded_capture_failure(
    monkeypatch: pytest.MonkeyPatch,
    browser_code: str,
    error_code: str,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    _fail_reply(
        lens,
        _capture_commands(lens)[0],
        code=browser_code,
        message="The cell output cannot be captured.",
    )

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)

    assert raised.value.code == error_code
    assert str(raised.value) == f"{error_code}: The cell output cannot be captured."
    assert lens._cell_image("cell-view", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


def test_different_cell_is_rejected_while_capture_is_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    first = _capture_commands(lens)[0]

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-other", expected_revision=0)

    assert raised.value.code == "capture_busy"
    assert "cell 'cell-view'" in str(raised.value)
    assert "Poll that cell" in str(raised.value)
    assert len(_capture_commands(lens)) == 1

    data = png()
    _reply(lens, first, data=data)
    assert lens._cell_image("cell-view", expected_revision=0) == data
    assert lens._cell_image("cell-other", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


def test_browser_unready_fails_the_pending_cell_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None

    _set_browser_ready(lens, False)

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)
    assert raised.value.code == "browser_unavailable"


def test_invalid_capture_response_raises_capture_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None

    _reply(lens, _capture_commands(lens)[0], data=png(), cell_id="cell-other")

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)
    assert raised.value.code == "capture_failed"


def test_unrelated_response_does_not_change_the_pending_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = dict(_capture_commands(lens)[0])
    command["requestId"] = "another-request"

    _reply(lens, command, data=png())

    assert lens._cell_image("cell-view", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 1


def test_malformed_readiness_event_keeps_pending_capture_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    try:
        assert lens._cell_image("cell-view", expected_revision=0) is None
        command = _capture_commands(lens)[0]
        lens._handle_lens_message(
            lens,
            {"protocol": "marimo-lens.event", "version": 6, "type": {}, "payload": {}},
            (),
        )
        data = png()
        _reply(lens, command, data=data)

        assert lens._cell_image("cell-view", expected_revision=0) == data
    finally:
        lens.close()


def test_stalled_capture_reports_timeout_and_ignores_late_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._output_capture as capture_module

    ManualTimer.instances = []
    monkeypatch.setattr(capture_module.threading, "Timer", ManualTimer)
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]
    timer = ManualTimer.instances[-1]

    timer.fire()
    _reply(lens, command, data=png())

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)
    assert raised.value.code == "capture_timeout"
    assert timer.daemon is True


def test_timed_out_capture_does_not_block_another_cell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._output_capture as capture_module

    ManualTimer.instances = []
    monkeypatch.setattr(capture_module.threading, "Timer", ManualTimer)
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    timer = ManualTimer.instances[-1]

    timer.fire()

    assert lens._cell_image("cell-other", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


def test_timeout_callback_cannot_replace_completed_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._output_capture as capture_module

    ManualTimer.instances = []
    monkeypatch.setattr(capture_module.threading, "Timer", ManualTimer)
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    data = png()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]
    timer = ManualTimer.instances[-1]

    _reply(lens, command, data=data)
    timer.function(*timer.args, **timer.kwargs)

    assert lens._cell_image("cell-view", expected_revision=0) == data


def test_stale_revision_capture_does_not_block_a_fresh_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    old_data = png(2, 2)
    fresh_data = png(3, 2)
    assert lens._cell_image("cell-view", expected_revision=0) is None
    old_command = _capture_commands(lens)[0]
    _put_selection(lens, selection(), revision=0)

    assert lens._cell_image("cell-view", expected_revision=1) is None
    fresh_command = _capture_commands(lens)[1]
    _reply(lens, old_command, data=old_data)
    _reply(lens, fresh_command, data=fresh_data, width=3, height=2)

    assert lens._cell_image("cell-view", expected_revision=1) == fresh_data


@pytest.mark.parametrize(
    ("runtime_status", "code"),
    [("missing", "cell_not_found"), ("unavailable", "runtime_unavailable")],
)
def test_cell_image_requires_an_exact_runtime_cell(
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
        lens._cell_image("cell-view", expected_revision=0)

    assert raised.value.code == code
    assert _capture_commands(lens) == []


def test_cell_image_requires_a_displayed_capture_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens(browser_ready=False)

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)

    assert raised.value.code == "browser_unavailable"


def test_capture_send_failure_raises_immediately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = FailingCaptureLens()

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)

    assert raised.value.code == "capture_failed"


def test_close_releases_cell_image_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._output_capture as capture_module

    ManualTimer.instances = []
    monkeypatch.setattr(capture_module.threading, "Timer", ManualTimer)
    _install_runtime(monkeypatch)
    lens = RecordingLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]
    slot = lens._output_capture
    timer = ManualTimer.instances[-1]

    lens.close()
    _reply(lens, command, data=png())

    with pytest.raises(LensError) as raised:
        slot.image("cell-view", expected_revision=0)
    assert raised.value.code == "lens_closed"
    assert timer.cancelled is True
    assert slot._record is None


@pytest.mark.parametrize(
    ("value", "error_type", "message"),
    [
        (1, TypeError, "cell_id must be a string"),
        ("", ValueError, "cell_id must not be empty"),
        ("x" * 129, ValueError, "at most 128 UTF-16 code units"),
    ],
)
def test_cell_image_validates_cell_id(
    monkeypatch: pytest.MonkeyPatch,
    value: object,
    error_type: type[Exception],
    message: str,
) -> None:
    _install_runtime(monkeypatch)
    lens = RecordingLens()

    with pytest.raises(error_type, match=message):
        lens._cell_image(cast(Any, value), expected_revision=0)


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
            "version": 6,
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
            "version": 6,
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
            "version": 6,
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
            "version": 6,
            "requestId": command["requestId"],
            "ok": False,
            "revision": 0,
            "payload": {"outputCellId": payload["outputCellId"]},
            "error": {"code": code, "message": message},
        },
        [],
    )
