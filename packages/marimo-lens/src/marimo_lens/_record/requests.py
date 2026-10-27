"""Track open requests and turn them into record requests and chat references."""

from __future__ import annotations

import logging
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import replace
from typing import Any

from .._core.bounds import MAX_HISTORY_NOTE, utf16_prefix
from .._notebook.snapshot import RuntimeSnapshot
from .lines import OpenRequest, code_hashes

_LOGGER = logging.getLogger(__name__)


def chats_trait(chats: Sequence[OpenRequest]) -> list[dict[str, Any]]:
    """Return the chats trait: the open chat requests, oldest first."""

    return [
        {
            "id": chat.id,
            "note": utf16_prefix(chat.note, MAX_HISTORY_NOTE),
            "openedAt": chat.opened_at,
        }
        for chat in chats
    ]


def chat_reference(request: OpenRequest) -> dict[str, Any]:
    """A chat request's reference, its cells without the status a snapshot adds."""

    hashes = code_hashes(request.baseline, request.cell_ids)
    return {
        "id": request.id,
        "note": request.note,
        "cells": [
            {"id": cell_id, "codeHash": hashes.get(cell_id)}
            for cell_id in request.cell_ids
        ],
        "openedAt": request.opened_at,
    }


ChatWatcher = Callable[[tuple[OpenRequest, ...]], None]


class RequestLedger:
    """Hold open requests next to the selection state that browsers see.

    A chat request belongs to the runtime, so every Lens watches the open
    chats. Callers hold the runtime lock, so watchers hear changes in order.
    """

    __slots__ = ("_open", "_watchers")

    def __init__(self) -> None:
        self._open: dict[str, OpenRequest] = {}
        self._watchers: list[ChatWatcher] = []

    def watch_chats(self, watcher: ChatWatcher) -> Callable[[], None]:
        self._watchers.append(watcher)

        def unwatch() -> None:
            if watcher in self._watchers:
                self._watchers.remove(watcher)

        return unwatch

    def get(self, request_id: str) -> OpenRequest | None:
        return self._open.get(request_id)

    def __getitem__(self, request_id: str) -> OpenRequest:
        return self._open[request_id]

    def source_bytes(self, owners: Iterable[str]) -> int:
        """Count source strings held by these owners' baselines once per object."""

        retained = set(owners)
        seen: set[int] = set()
        total = 0
        for request in self._open.values():
            if request.owner not in retained:
                continue
            for cell in (*request.baseline.cells, *request.baseline.unregistered):
                identity = id(cell.code)
                if identity not in seen:
                    seen.add(identity)
                    total += sys.getsizeof(cell.code)
        return total

    def chats(self) -> tuple[OpenRequest, ...]:
        return tuple(
            request for request in self._open.values() if request.channel == "chat"
        )

    def add(self, request: OpenRequest) -> OpenRequest:
        """Open ``request`` and name it concurrent with every open request."""

        others = frozenset(self._open)
        for other_id in others:
            other = self._open[other_id]
            self._open[other_id] = replace(
                other, concurrent=other.concurrent | {request.id}
            )
        request = replace(request, concurrent=others)
        self._open[request.id] = request
        if request.channel == "chat":
            self._announce_chats()
        return request

    def close(self, request_ids: Sequence[str]) -> dict[str, OpenRequest]:
        closed = {
            request_id: request
            for request_id in request_ids
            if (request := self._open.pop(request_id, None)) is not None
        }
        if any(request.channel == "chat" for request in closed.values()):
            self._announce_chats()
        return closed

    def _announce_chats(self) -> None:
        chats = self.chats()
        for watcher in tuple(self._watchers):
            try:
                watcher(chats)
            except Exception:
                _LOGGER.exception("A chat request watcher failed")

    def order(self) -> dict[str, int]:
        """Return each open request's position in the order requests opened."""

        return {request_id: index for index, request_id in enumerate(self._open)}

    def unopened(self, request_ids: Iterable[str]) -> tuple[str, ...]:
        return tuple(
            request_id for request_id in request_ids if request_id not in self._open
        )

    def sync_selections(
        self,
        owner: str,
        open_selection_ids: Iterable[str],
        *,
        opened_at: str,
        baseline: RuntimeSnapshot | None,
    ) -> None:
        """Open requests for an owner's new selections and forget closed ones.

        ``baseline`` is required when a selection is new or reopened.
        """

        selection_ids = tuple(dict.fromkeys(open_selection_ids))
        self.release(owner, keep=set(selection_ids))
        for request_id in self.unopened(selection_ids):
            if baseline is None:
                raise ValueError("A new selection request needs a baseline.")
            self.add(
                OpenRequest(
                    id=request_id,
                    channel="selection",
                    opened_at=opened_at,
                    baseline=baseline,
                    owner=owner,
                )
            )

    def release(self, owner: str, *, keep: set[str] | None = None) -> None:
        for request_id, request in tuple(self._open.items()):
            if request.owner == owner and request_id not in (keep or ()):
                del self._open[request_id]
