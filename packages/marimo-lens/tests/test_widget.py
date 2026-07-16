from __future__ import annotations

import copy
import inspect
import json
from collections.abc import Sequence
from typing import Any, cast

import marimo_lens
import pytest
from marimo_lens import Lens, LensContext, SelectionImage

from tests.support.factories import (
    cell,
    png,
    selection,
    snapshot,
    snapshot_metadata,
)


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


class FailingPublishLens(RecordingLens):
    fail_next_state_publish = False

    def set_trait(self, name: str, value: Any) -> None:
        if name == "_state" and self.fail_next_state_publish:
            self.fail_next_state_publish = False
            raise RuntimeError("state publish failed")
        super().set_trait(name, value)


def test_public_api_has_one_constructor_and_one_context_operation() -> None:
    assert marimo_lens.__all__ == ["Lens", "LensContext", "SelectionImage"]
    assert inspect.signature(Lens).parameters == {}
    assert LensContext.__module__ == "marimo_lens.context"
    assert SelectionImage.__module__ == "marimo_lens.context"

    lens = RecordingLens()

    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
    }
    assert lens._lens_css == lens.bundle.read_style()


def test_pointer_release_selection_exists_before_image_capture() -> None:
    lens = RecordingLens()

    response = _put(lens, revision=0, selection_value=selection(note=""))

    assert response["ok"] is True
    assert response["version"] == 1
    assert response["revision"] == 1
    assert response["payload"]["selection"]["label"] == "S1"
    assert _state(lens)["nextLabel"] == "S2"
    assert _state(lens)["currentSelectionId"] == "selection-1"
    assert _selections(lens)[0]["note"] == ""
    assert _selections(lens)[0]["snapshot"] == {"status": "pending"}
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S1"
    assert context.images == ()


def test_async_image_replace_does_not_steal_current_selection() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    data = png()
    first = copy.deepcopy(_selections(lens)[0])
    first["snapshot"] = snapshot_metadata(data)

    response = _put(
        lens,
        revision=2,
        selection_value=first,
        data=data,
        image_action="replace",
    )

    assert response["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-2"
    context = lens.context()
    assert context.current is not None
    assert context.current["label"] == "S2"
    assert context.images[0].selection_id == "selection-1"
    assert context.images[0].data == data


def test_synced_state_is_a_python_owned_projection() -> None:
    lens = RecordingLens()

    lens.set_trait(
        "_state",
        {
            "revision": 99,
            "nextLabel": "S99",
            "currentSelectionId": "selection-99",
            "selections": [selection()],
        },
    )

    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
    }


def test_close_releases_images_and_rejects_later_context_and_commands() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )

    lens.close()

    assert lens._images.total_bytes == 0
    with pytest.raises(RuntimeError, match="Lens is closed"):
        lens.context()

    response = _clear(lens, revision=1)
    assert response["ok"] is False
    assert response["error"]["code"] == "lens_closed"


def test_selection_count_matches_the_provenance_capacity() -> None:
    lens = RecordingLens()
    for index in range(64):
        response = _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
                output_cell_id=f"cell-{index + 1}",
            ),
        )
        assert response["ok"] is True

    response = _put(
        lens,
        revision=64,
        selection_value=selection(
            selection_id="selection-65",
            label="S65",
            output_cell_id="cell-65",
        ),
    )

    assert response["ok"] is False
    assert response["error"]["code"] == "selection_limit_reached"


def test_selection_growth_is_rejected_before_state_changes() -> None:
    lens = RecordingLens()
    accepted = 0
    while True:
        response = _put(
            lens,
            revision=accepted,
            selection_value=selection(
                selection_id=f"selection-{accepted + 1}",
                label=f"S{accepted + 1}",
                note="x" * 4_000,
            ),
        )
        if response["ok"] is False:
            break
        accepted += 1

    assert response["error"]["code"] == "selection_context_limit"
    assert _state(lens)["revision"] == accepted
    assert _state(lens)["nextLabel"] == f"S{accepted + 1}"
    assert len(_selections(lens)) == accepted
    assert lens.context().images == ()


def test_new_labels_are_server_checked_and_never_reused() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _delete(lens, revision=1, selection_id="selection-1")

    reused = _put(
        lens,
        revision=2,
        selection_value=selection(selection_id="selection-2", label="S1"),
    )
    assert reused["ok"] is False
    assert reused["error"]["code"] == "selection_label_conflict"
    assert _state(lens)["nextLabel"] == "S2"

    accepted = _put(
        lens,
        revision=2,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    assert accepted["ok"] is True
    _clear(lens, revision=3)
    assert _state(lens) == {
        "revision": 4,
        "nextLabel": "S3",
        "currentSelectionId": None,
        "selections": [],
    }


def test_creation_activation_and_note_edits_define_current_selection() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())
    _put(
        lens,
        revision=1,
        selection_value=selection(selection_id="selection-2", label="S2"),
    )
    assert _state(lens)["currentSelectionId"] == "selection-2"

    activated = _activate(lens, revision=2, selection_id="selection-1")
    assert activated["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-1"

    edited = copy.deepcopy(_selections(lens)[1])
    edited["note"] = "Use this selection."
    response = _put(
        lens,
        revision=3,
        selection_value=edited,
        image_action="preserve",
    )
    assert response["ok"] is True
    assert _state(lens)["currentSelectionId"] == "selection-2"


def test_deleting_current_falls_back_to_most_recent_remaining_selection() -> None:
    lens = RecordingLens()
    for index in range(3):
        _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
            ),
        )
    _activate(lens, revision=3, selection_id="selection-1")
    _activate(lens, revision=4, selection_id="selection-3")

    _delete(lens, revision=5, selection_id="selection-3")

    assert _state(lens)["currentSelectionId"] == "selection-1"
    _delete(lens, revision=6, selection_id="selection-2")
    assert _state(lens)["currentSelectionId"] == "selection-1"
    _delete(lens, revision=7, selection_id="selection-1")
    assert _state(lens)["currentSelectionId"] is None


def test_preserve_can_change_note_without_changing_capture_geometry() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    edited = copy.deepcopy(_selections(lens)[0])
    edited["note"] = "Use the table ordering here."

    response = _put(
        lens,
        revision=1,
        selection_value=edited,
        image_action="preserve",
    )

    assert response["ok"] is True
    assert _selections(lens)[0]["note"] == edited["note"]
    assert lens.context().images[0].data == data

    moved = copy.deepcopy(_selections(lens)[0])
    moved["anchor"]["x"] = 0.5
    rejected = _put(
        lens,
        revision=2,
        selection_value=moved,
        image_action="preserve",
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "selection_capture_changed"
    assert _state(lens)["revision"] == 2


def test_outdated_snapshot_retains_capture_bytes() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )
    outdated = copy.deepcopy(_selections(lens)[0])
    outdated["anchor"]["x"] = 0.5
    outdated["snapshot"]["status"] = "outdated"

    response = _put(
        lens,
        revision=1,
        selection_value=outdated,
        image_action="preserve",
    )

    assert response["ok"] is True
    context = lens.context()
    references = cast(dict[str, Any], context.references)
    assert references["selections"][0]["snapshot"] == {"status": "outdated"}
    assert references["selections"][0]["anchor"]["x"] == 0.5
    assert context.images[0].data == data
    assert context.images[0].outdated is True


def test_every_mutation_rejects_stale_revision_before_changing_state() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())

    stale_put = _put(
        lens,
        revision=0,
        selection_value=copy.deepcopy(_selections(lens)[0]),
        image_action="preserve",
    )
    stale_activate = _activate(lens, revision=0, selection_id="selection-1")
    stale_delete = _delete(lens, revision=0, selection_id="selection-1")
    stale_clear = _clear(lens, revision=0)

    assert stale_put["error"]["code"] == "revision_conflict"
    assert stale_activate["error"]["code"] == "revision_conflict"
    assert stale_delete["error"]["code"] == "revision_conflict"
    assert stale_clear["error"]["code"] == "revision_conflict"
    assert _state(lens)["revision"] == 1
    assert _state(lens)["currentSelectionId"] == "selection-1"


def test_trait_publish_failure_rolls_back_selection_current_mru_and_image() -> None:
    lens = FailingPublishLens()
    data = png()
    lens.fail_next_state_publish = True

    failed_put = _put(
        lens,
        revision=0,
        data=data,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        image_action="replace",
    )

    assert failed_put["error"]["code"] == "internal_error"
    assert _state(lens) == {
        "revision": 0,
        "nextLabel": "S1",
        "currentSelectionId": None,
        "selections": [],
    }
    assert lens.context().images == ()

    for index in range(3):
        _put(
            lens,
            revision=index,
            selection_value=selection(
                selection_id=f"selection-{index + 1}",
                label=f"S{index + 1}",
            ),
        )
    lens.fail_next_state_publish = True
    failed_activate = _activate(lens, revision=3, selection_id="selection-1")
    assert failed_activate["error"]["code"] == "internal_error"
    assert _state(lens)["currentSelectionId"] == "selection-3"

    _delete(lens, revision=3, selection_id="selection-3")
    assert _state(lens)["currentSelectionId"] == "selection-2"


def test_context_export_uses_one_runtime_and_selection_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens.widget as widget_module

    runtime = snapshot(
        cell("cell-data", code="chart = make_chart()", defs=("chart",)),
        cell(
            "cell-view",
            code="chart",
            refs=("chart",),
            upstream=("cell-data",),
        ),
    )
    monkeypatch.setattr(widget_module, "collect_runtime_snapshot", lambda: runtime)
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection())

    _send(lens, "context.export", {"format": "text"})
    response = lens.sent[-1][0]

    assert response["ok"] is True
    assert response["revision"] == 1
    assert "chart = make_chart()" in response["payload"]["text"]
    assert "Cell `cell-view`" in response["payload"]["text"]
    context = lens.context()
    references = cast(dict[str, Any], context.references)
    assert references["selections"][0]["outputCellId"] == "cell-view"
    assert "cells" not in references
    assert references["revision"] == response["revision"]


def test_context_export_projects_current_and_all_references() -> None:
    lens = RecordingLens()
    _put(lens, revision=0, selection_value=selection(note="Inspect this value"))

    _send(lens, "context.export", {"format": "current"})
    current = json.loads(lens.sent[-1][0]["payload"]["text"])
    _send(lens, "context.export", {"format": "references"})
    references = json.loads(lens.sent[-1][0]["payload"]["text"])

    assert current["id"] == "selection-1"
    assert current["outputCellId"] == "cell-view"
    assert "source" not in current
    assert references["currentSelectionId"] == "selection-1"
    assert references["selections"] == [current]


def test_snapshot_get_returns_the_exact_stored_png() -> None:
    lens = RecordingLens()
    data = png()
    _put(
        lens,
        revision=0,
        selection_value=selection(snapshot=snapshot_metadata(data)),
        data=data,
        image_action="replace",
    )

    _send(lens, "snapshot.get", {"selectionId": "selection-1"})
    response, buffers = lens.sent[-1]

    assert response["ok"] is True
    assert response["version"] == 1
    assert response["payload"]["selectionId"] == "selection-1"
    assert (
        response["payload"]["snapshot"]["sha256"] == snapshot_metadata(data)["sha256"]
    )
    assert buffers == [data]


def _put(
    lens: RecordingLens,
    *,
    revision: int,
    selection_value: dict[str, Any],
    data: bytes | None = None,
    image_action: str = "clear",
) -> dict[str, Any]:
    buffers = [data] if image_action == "replace" and data is not None else []
    _send(
        lens,
        "selection.put",
        {
            "selection": selection_value,
            "expectedRevision": revision,
            "imageAction": image_action,
        },
        buffers=buffers,
    )
    return lens.sent[-1][0]


def _activate(
    lens: RecordingLens,
    *,
    revision: int,
    selection_id: str,
) -> dict[str, Any]:
    _send(
        lens,
        "selection.activate",
        {"selectionId": selection_id, "expectedRevision": revision},
    )
    return lens.sent[-1][0]


def _delete(
    lens: RecordingLens,
    *,
    revision: int,
    selection_id: str,
) -> dict[str, Any]:
    _send(
        lens,
        "selection.delete",
        {"selectionId": selection_id, "expectedRevision": revision},
    )
    return lens.sent[-1][0]


def _clear(lens: RecordingLens, *, revision: int) -> dict[str, Any]:
    _send(lens, "selections.clear", {"expectedRevision": revision})
    return lens.sent[-1][0]


def _send(
    lens: RecordingLens,
    command_type: str,
    payload: dict[str, Any],
    *,
    buffers: Sequence[bytes] = (),
) -> None:
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.command",
            "version": 1,
            "requestId": f"request-{len(lens.sent) + 1}",
            "type": command_type,
            "payload": payload,
        },
        list(buffers),
    )


def _state(lens: RecordingLens) -> dict[str, Any]:
    return cast(dict[str, Any], lens._state)


def _selections(lens: RecordingLens) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], _state(lens)["selections"])
