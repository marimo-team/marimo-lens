from __future__ import annotations

import json
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


def test_lens_serves_its_built_app_and_handles_lens_messages() -> None:
    static_dir = pathlib.Path(__file__).parents[1] / "src" / "marimo_lens" / "static"
    manifest = json.loads((static_dir / "anywidget.json").read_text(encoding="utf-8"))
    app_path = str(manifest["app"])
    app_source = static_dir.joinpath(*app_path.split("/")).read_bytes()
    lens = RecordingLens()

    lens._handle_custom_msg(
        {
            "type": "anywidget-bundle:request",
            "version": 1,
            "id": "bundle-request",
            "path": app_path,
        },
        [],
    )
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.command",
            "version": 1,
            "requestId": "clear-request",
            "type": "selections.clear",
            "payload": {"expectedRevision": 0},
        },
        [],
    )

    assert len(lens.sent) == 2
    bundle_response, bundle_buffers = lens.sent[0]
    assert bundle_response == {
        "type": "anywidget-bundle:response",
        "version": 1,
        "id": "bundle-request",
        "path": app_path,
    }
    assert bundle_buffers == [app_source]

    lens_response, lens_buffers = lens.sent[1]
    assert lens_response["protocol"] == "marimo-lens.response"
    assert lens_response["requestId"] == "clear-request"
    assert lens_response["ok"] is True
    assert lens_response["payload"] == {}
    assert lens_buffers == []
