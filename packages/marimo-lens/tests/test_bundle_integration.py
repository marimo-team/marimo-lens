from __future__ import annotations

import pathlib
from collections.abc import Sequence
from typing import Any

from marimo_lens import Lens


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


def test_exported_lens_renders_directly_in_marimo() -> None:
    from marimo._output.formatting import try_format

    lens = Lens()

    formatted = try_format(lens)

    assert formatted.mimetype == "text/html"
    assert "marimo-anywidget" in formatted.data
    lens.close()


def test_lens_loads_esbuild_assets_and_handles_lens_messages() -> None:
    static_dir = pathlib.Path(__file__).parents[1] / "src" / "marimo_lens" / "static"
    widget_source = (static_dir / "widget.js").read_text(encoding="utf-8")
    widget_css = (static_dir / "widget.css").read_text(encoding="utf-8")
    lens = RecordingLens()

    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.command",
            "version": 2,
            "requestId": "clear-request",
            "type": "selections.clear",
            "payload": {"expectedRevision": 0},
        },
        [],
    )

    assert lens._esm == widget_source
    assert lens._css == widget_css
    assert len(lens.sent) == 1
    lens_response, lens_buffers = lens.sent[0]
    assert lens_response["protocol"] == "marimo-lens.response"
    assert lens_response["requestId"] == "clear-request"
    assert lens_response["ok"] is True
    assert lens_response["payload"] == {}
    assert lens_buffers == []
    lens.close()
