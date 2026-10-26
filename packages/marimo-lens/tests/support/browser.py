"""Drive a Lens through the commands its browser view sends."""

from __future__ import annotations

import struct
from collections.abc import Sequence
from typing import Any, cast

from marimo_lens import Lens, Record, RecordOptions
from marimo_lens._protocol.messages import PROTOCOL_VERSION

from tests.support.factories import snapshot_metadata


class BrowserLens(Lens):
    """A Lens whose browser messages the test sends and records."""

    sent: list[tuple[dict[str, Any], list[bytes]]]

    def __init__(
        self,
        *,
        record: Record | RecordOptions | bool | None = None,
        dom_selector: str | None = None,
        displayed: bool = True,
    ) -> None:
        self.sent = []
        super().__init__(record=record, dom_selector=dom_selector)
        if displayed:
            self.display()

    def display(self) -> None:
        """Announce a browser view, as a rendered Lens does once it loads."""

        self._handle_lens_message(
            self,
            {
                "protocol": "marimo-lens.event",
                "version": PROTOCOL_VERSION,
                "type": "output.capture.ready",
                "payload": {},
            },
            [],
        )

    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        self.sent.append((content, [bytes(buffer) for buffer in buffers or []]))

    @property
    def revision(self) -> int:
        return cast(int, self.synced_state()["revision"])

    def synced_state(self) -> dict[str, Any]:
        return cast(dict[str, Any], self._state)

    def synced_history(self) -> dict[str, Any]:
        history = self._history
        assert history is not None, "This Lens shows no History."
        return history

    def synced_chats(self) -> list[dict[str, Any]]:
        return cast(list[dict[str, Any]], self._chats)

    def history_entries(self) -> list[dict[str, Any]]:
        return cast(list[dict[str, Any]], self.synced_history()["entries"])

    def respond(
        self,
        command_type: str,
        payload: dict[str, Any],
        *,
        buffers: Sequence[bytes] = (),
    ) -> dict[str, Any]:
        """Send one browser command and return the response, accepted or not."""

        self._handle_custom_msg(
            {
                "protocol": "marimo-lens.command",
                "version": PROTOCOL_VERSION,
                "requestId": f"request-{len(self.sent) + 1}",
                "type": command_type,
                "payload": payload,
            },
            list(buffers),
        )
        return self.sent[-1][0]

    def command(
        self,
        command_type: str,
        payload: dict[str, Any],
        *,
        buffers: Sequence[bytes] = (),
    ) -> dict[str, Any]:
        response = self.respond(command_type, payload, buffers=buffers)
        assert response.get("ok") is True, response
        return response

    def refused(self, command_type: str, payload: dict[str, Any]) -> str:
        """Send one browser command that Lens refuses and return its error code."""

        response = self.respond(command_type, payload)
        assert response["ok"] is False, response
        return cast(str, response["error"]["code"])

    def put(
        self, selection: dict[str, Any], *, image: bytes | None = None
    ) -> dict[str, Any]:
        """Put a selection, with ``image`` as its captured PNG when given."""

        if image is not None:
            width, height = struct.unpack(">II", image[16:24])
            selection = {
                **selection,
                "snapshot": snapshot_metadata(
                    image, selection_id=selection["id"], width=width, height=height
                ),
            }
        return self.command(
            "selection.put",
            {
                "selection": selection,
                "expectedRevision": self.revision,
                "imageAction": "clear" if image is None else "replace",
            },
            buffers=() if image is None else [image],
        )


class RecordBrowserLens(BrowserLens):
    def __init__(
        self,
        *,
        record: Record | RecordOptions | bool | None = True,
        dom_selector: str | None = None,
        displayed: bool = True,
    ) -> None:
        super().__init__(record=record, dom_selector=dom_selector, displayed=displayed)
