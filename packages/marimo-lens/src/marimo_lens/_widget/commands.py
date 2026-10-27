"""Apply one browser command to a Lens session and build its response."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .._protocol.codec import snapshot_metadata, success_response
from .._protocol.messages import (
    ActivateSelectionCommand,
    ClearHistoryCommand,
    ClearSelectionsCommand,
    ClientCommand,
    DeleteSelectionCommand,
    GetSnapshotCommand,
    PutSelectionCommand,
    ReopenSelectionCommand,
)
from .._schema.model import dump_model
from .._session.session import LensSession


def execute(
    session: LensSession,
    command: ClientCommand,
    buffers: Sequence[bytes | bytearray | memoryview],
) -> tuple[dict[str, Any], tuple[bytes, ...]]:
    """Run ``command`` against ``session`` and return the response and its buffers.

    Raises:
        Rejection: The session refused the change.
        LensError: The session cannot apply the command now.
    """

    match command:
        case GetSnapshotCommand(payload=payload):
            image = session.image(payload.selection_id)
            return success_response(
                request_id=command.request_id,
                revision=session.state.revision,
                payload={
                    "selectionId": payload.selection_id,
                    "snapshot": snapshot_metadata(image),
                },
            ), (image.data,)
        case PutSelectionCommand(payload=payload):
            state, committed = session.put_selection(
                payload.selection,
                image_action=payload.image_action,
                expected_revision=payload.expected_revision,
                image=buffers[0] if payload.image_action == "replace" else None,
            )
            return success_response(
                request_id=command.request_id,
                revision=state.revision,
                payload={"selection": dump_model(committed)},
            ), ()
        case ActivateSelectionCommand(payload=payload):
            selection_id = payload.selection_id
            state = session.activate_selection(
                selection_id, expected_revision=payload.expected_revision
            )
        case DeleteSelectionCommand(payload=payload):
            selection_id = payload.selection_id
            state = session.delete_selection(
                selection_id, expected_revision=payload.expected_revision
            )
        case ReopenSelectionCommand(payload=payload):
            selection_id = payload.selection_id
            state = session.reopen_selection(
                selection_id,
                resolution_revision=payload.resolution_revision,
                expected_revision=payload.expected_revision,
            )
        case ClearSelectionsCommand(payload=payload):
            selection_id = None
            state = session.clear_selections(
                expected_revision=payload.expected_revision
            )
        case ClearHistoryCommand(payload=payload):
            selection_id = None
            state = session.clear_history(expected_revision=payload.expected_revision)
    return success_response(
        request_id=command.request_id,
        revision=state.revision,
        payload={} if selection_id is None else {"selectionId": selection_id},
    ), ()
