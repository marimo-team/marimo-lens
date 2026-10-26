from __future__ import annotations

import hashlib
import threading
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest
from marimo_lens import LensError
from marimo_lens._protocol.messages import PROTOCOL_VERSION

from tests.support.browser import BrowserLens
from tests.support.factories import png, selection


class FailingCaptureLens(BrowserLens):
    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        if content.get("type") == "output.capture":
            raise RuntimeError("browser disconnected")
        super().send(content, buffers)


class Clock:
    """Stands in for the monotonic clock that capture deadlines read."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import marimo_lens._widget.capture as capture_module

        self.now = 1_000.0
        monkeypatch.setattr(capture_module, "monotonic", lambda: self.now)

    def pass_deadline(self) -> None:
        self.now += 21.0


def test_cell_image_reuses_pending_capture_and_consumes_completed_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = BrowserLens()
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


def test_selection_change_waits_for_the_runtime_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo_lens._marimo.adapter import MarimoRuntimeAdapter

    lens: BrowserLens
    change = threading.Thread(
        target=lambda: lens.put(selection(selection_id="selection-2", label="S2"))
    )

    def check_cell(_runtime: MarimoRuntimeAdapter, _cell_id: str) -> str:
        change.start()
        change.join(timeout=0.2)
        assert change.is_alive()
        return "available"

    monkeypatch.setattr(MarimoRuntimeAdapter, "cell_status", check_cell)
    lens = BrowserLens()
    lens.put(selection())

    assert lens._cell_image("cell-view", expected_revision=1) is None
    change.join(timeout=5)

    assert len(_capture_commands(lens)) == 1
    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=1)
    assert raised.value.code == "revision_conflict"
    assert raised.value.revision == 2


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
    lens = BrowserLens()
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
    lens = BrowserLens()
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


def test_invalid_capture_response_raises_capture_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = BrowserLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None

    _reply(lens, _capture_commands(lens)[0], data=png(), cell_id="cell-other")

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)
    assert raised.value.code == "capture_failed"


def test_unrelated_response_does_not_change_the_pending_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = BrowserLens()
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
    lens = BrowserLens()
    try:
        assert lens._cell_image("cell-view", expected_revision=0) is None
        command = _capture_commands(lens)[0]
        lens._handle_lens_message(
            lens,
            {
                "protocol": "marimo-lens.event",
                "version": PROTOCOL_VERSION,
                "type": {},
                "payload": {},
            },
            (),
        )
        data = png()
        _reply(lens, command, data=data)

        assert lens._cell_image("cell-view", expected_revision=0) == data
    finally:
        lens.close()


def test_timed_out_capture_ignores_a_late_response_and_frees_the_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = BrowserLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]

    clock.pass_deadline()
    _reply(lens, command, data=png())

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)
    assert raised.value.code == "capture_timeout"
    assert lens._cell_image("cell-other", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


def test_timed_out_capture_does_not_block_another_cell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    _install_runtime(monkeypatch, "cell-view", "cell-other")
    lens = BrowserLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None

    clock.pass_deadline()

    assert lens._cell_image("cell-other", expected_revision=0) is None
    assert len(_capture_commands(lens)) == 2


def test_a_capture_completed_before_its_deadline_is_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock(monkeypatch)
    _install_runtime(monkeypatch)
    lens = BrowserLens()
    data = png()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]

    _reply(lens, command, data=data)
    clock.pass_deadline()

    assert lens._cell_image("cell-view", expected_revision=0) == data


def test_stale_revision_capture_does_not_block_a_fresh_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_runtime(monkeypatch)
    lens = BrowserLens()
    old_data = png(2, 2)
    fresh_data = png(3, 2)
    assert lens._cell_image("cell-view", expected_revision=0) is None
    old_command = _capture_commands(lens)[0]
    lens.put(selection())

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
    from marimo_lens._marimo.adapter import MarimoRuntimeAdapter

    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, _cell_id: runtime_status,
    )
    lens = BrowserLens()

    with pytest.raises(LensError) as raised:
        lens._cell_image("cell-view", expected_revision=0)

    assert raised.value.code == code
    assert _capture_commands(lens) == []


@pytest.mark.parametrize("displayed", [False, True], ids=["never", "then-unready"])
def test_cell_image_needs_a_displayed_browser(
    monkeypatch: pytest.MonkeyPatch, displayed: bool
) -> None:
    _install_runtime(monkeypatch)
    lens = BrowserLens(displayed=displayed)
    if displayed:
        assert lens._cell_image("cell-view", expected_revision=0) is None
        lens._handle_lens_message(
            lens,
            {
                "protocol": "marimo-lens.event",
                "version": PROTOCOL_VERSION,
                "type": "output.capture.unready",
                "payload": {},
            },
            (),
        )

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
    _install_runtime(monkeypatch)
    lens = BrowserLens()
    assert lens._cell_image("cell-view", expected_revision=0) is None
    command = _capture_commands(lens)[0]
    slot = lens._output_capture

    lens.close()
    _reply(lens, command, data=png())

    with pytest.raises(LensError) as raised:
        slot.image("cell-view", expected_revision=0)
    assert raised.value.code == "lens_closed"
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
    lens = BrowserLens()

    with pytest.raises(error_type, match=message):
        lens._cell_image(cast(Any, value), expected_revision=0)


def _install_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *cell_ids: str,
) -> None:
    from marimo_lens._marimo.adapter import MarimoRuntimeAdapter

    available = cell_ids or ("cell-view",)
    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "cell_status",
        lambda _self, cell_id: "available" if cell_id in available else "missing",
    )


def _capture_commands(lens: BrowserLens) -> list[dict[str, Any]]:
    return [
        content
        for content, _buffers in lens.sent
        if content.get("type") == "output.capture"
    ]


def _reply(
    lens: BrowserLens,
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
            "version": PROTOCOL_VERSION,
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
    lens: BrowserLens,
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
            "version": PROTOCOL_VERSION,
            "requestId": command["requestId"],
            "ok": False,
            "revision": 0,
            "payload": {"outputCellId": payload["outputCellId"]},
            "error": {"code": code, "message": message},
        },
        [],
    )


def test_cell_image_needs_no_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    import threading

    def refuse(self: threading.Thread) -> None:
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(threading.Thread, "start", refuse)
    _install_runtime(monkeypatch)
    lens = BrowserLens()
    data = png()

    assert lens._cell_image("cell-view", expected_revision=0) is None
    _reply(lens, _capture_commands(lens)[0], data=data)

    assert lens._cell_image("cell-view", expected_revision=0) == data
