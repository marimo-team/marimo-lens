"""Immutable selection state and revision-checked transitions."""

from __future__ import annotations

import copy
import json
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from .._core.bounds import (
    MAX_SELECTION_LABEL,
    MAX_SELECTIONS,
)
from .._core.errors import Rejection
from .._schema.model import dump_model
from .._schema.selection import (
    AvailableSnapshot,
    ImageAction,
    OutdatedSnapshot,
    Selection,
    SelectionInput,
    SelectionSnapshot,
)
from .images import SelectionImage, prepare_selection_image
from .references import validate_reference_capacity

_IMMUTABLE_SELECTION_FIELDS = (
    ("label", "label"),
    ("target", "target"),
    ("created_at", "createdAt"),
    ("description", "description"),
)
MAX_SELECTION_STATE_BYTES = 48_000


@dataclass(frozen=True, slots=True)
class SelectionRecord:
    """One selection and every resource that shares its lifetime.

    ``payload`` is the browser-shaped selection, dumped once when the record
    is built. Every state that holds the record shares it, so readers copy
    before they change it.
    """

    selection: Selection
    image: SelectionImage | None
    payload: dict[str, Any] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", dump_model(self.selection))

    @property
    def id(self) -> str:
        return self.selection.id


@dataclass(frozen=True, slots=True)
class SelectionState:
    """One authoritative selection aggregate."""

    revision: int = 0
    next_label: int = 1
    current_selection_id: str | None = None
    activation_order: tuple[str, ...] = ()
    records: tuple[SelectionRecord, ...] = ()

    def record(self, selection_id: str) -> SelectionRecord | None:
        return next(
            (record for record in self.records if record.id == selection_id),
            None,
        )

    def selections(self) -> list[dict[str, Any]]:
        return [record.payload for record in self.records]

    def images(self) -> dict[str, bytes]:
        return {
            record.id: record.image.data
            for record in self.records
            if record.image is not None
        }

    @property
    def image_bytes(self) -> int:
        return sum(len(data) for data in self.images().values())

    def payload(self) -> dict[str, Any]:
        """Return the browser state as a value detached from the records."""

        return {
            "revision": self.revision,
            "nextLabel": f"S{self.next_label}",
            "currentSelectionId": self.current_selection_id,
            "selections": copy.deepcopy(self.selections()),
        }


def put_selection(
    state: SelectionState,
    selection: SelectionInput,
    *,
    image_action: ImageAction,
    expected_revision: int,
    image: bytes | bytearray | memoryview | None,
) -> tuple[SelectionState, Selection]:
    """Return the state after one put and the selection it committed.

    A new selection takes the next label, whatever label it arrived with.
    """

    _require_revision(state, expected_revision)
    existing_index = next(
        (
            index
            for index, record in enumerate(state.records)
            if record.id == selection.id
        ),
        None,
    )
    existing = state.records[existing_index] if existing_index is not None else None

    if existing is None:
        if len(state.records) >= MAX_SELECTIONS:
            raise Rejection(
                "selection_limit_reached",
                f"Lens supports up to {MAX_SELECTIONS} selections.",
            )
        if image_action == "preserve":
            raise Rejection(
                "selection_not_found",
                "A new selection cannot preserve an image.",
            )
    else:
        previous = existing.selection
        for field_name, alias in _IMMUTABLE_SELECTION_FIELDS:
            if getattr(selection, field_name) != getattr(previous, field_name):
                raise Rejection(
                    "selection_identity_changed",
                    f"Selection {alias} cannot change after creation.",
                )

    outdated_transition = False
    if existing is not None and image_action == "preserve":
        outdated_transition = _validate_preserved_snapshot(existing, selection.snapshot)
        if not outdated_transition and (
            selection.anchor != existing.selection.anchor
            or selection.dom_hint != existing.selection.dom_hint
        ):
            raise Rejection(
                "selection_capture_changed",
                "Changing selection geometry must mark its retained snapshot outdated.",
            )

    if image_action == "replace":
        # parse_command admits a replacement only with its one PNG buffer.
        assert image is not None
        current_image_bytes = (
            len(existing.image.data) if existing and existing.image else 0
        )
        retained = prepare_selection_image(
            selection.id,
            dump_model(selection.snapshot),
            image,
            other_bytes=state.image_bytes - current_image_bytes,
        )
    elif image_action == "clear":
        retained = None
    else:
        retained = existing.image if existing is not None else None
        if retained is not None and outdated_transition and not retained.outdated:
            retained = replace(retained, outdated=True)

    # Validating a detached dump keeps the committed selection from sharing
    # nested values with the command that carried it.
    committed = Selection.model_validate(
        {
            **selection.model_dump(),
            "label": f"S{state.next_label}" if existing is None else selection.label,
            "previous_resolution": (
                None if existing is None else existing.selection.previous_resolution
            ),
        }
    )
    record = SelectionRecord(selection=committed, image=retained)
    records = list(state.records)
    if existing_index is None:
        records.append(record)
    else:
        records[existing_index] = record

    current_selection_id = state.current_selection_id
    activation_order = state.activation_order
    if existing is None or _selection_edit_activates(existing.selection, committed):
        current_selection_id, activation_order = _activated_state(
            committed.id,
            activation_order,
        )

    next_state = _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label + (1 if existing is None else 0),
            current_selection_id=current_selection_id,
            activation_order=activation_order,
            records=tuple(records),
        )
    )
    return next_state, committed


def activate_selection(
    state: SelectionState,
    selection_id: str,
    *,
    expected_revision: int,
) -> SelectionState:
    _require_revision(state, expected_revision)
    if state.record(selection_id) is None:
        raise Rejection(
            "selection_not_found",
            "Cannot activate an unknown Lens selection.",
        )
    current_selection_id, activation_order = _activated_state(
        selection_id,
        state.activation_order,
    )
    return _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label,
            current_selection_id=current_selection_id,
            activation_order=activation_order,
            records=state.records,
        )
    )


def remove_selection(
    state: SelectionState,
    selection_id: str,
    *,
    expected_revision: int,
) -> tuple[SelectionState, SelectionRecord]:
    _require_revision(state, expected_revision)
    removed = state.record(selection_id)
    if removed is None:
        raise Rejection(
            "selection_not_found",
            "Cannot delete an unknown Lens selection.",
        )
    records = tuple(record for record in state.records if record.id != selection_id)
    activation_order = tuple(
        item for item in state.activation_order if item != selection_id
    )
    current_selection_id = state.current_selection_id
    if current_selection_id == selection_id:
        current_selection_id = activation_order[-1] if activation_order else None
    return (
        _admit_state(
            SelectionState(
                revision=state.revision + 1,
                next_label=state.next_label,
                current_selection_id=current_selection_id,
                activation_order=activation_order,
                records=records,
            )
        ),
        removed,
    )


def clear_selections(
    state: SelectionState,
    *,
    expected_revision: int,
) -> SelectionState:
    _require_revision(state, expected_revision)
    return _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label,
        )
    )


def resolve_selections(
    state: SelectionState,
    selection_ids: Sequence[str],
) -> tuple[SelectionState, tuple[SelectionRecord, ...]]:
    """Close open selections atomically and return them.

    Callers pass unique IDs of open selections, already checked against the
    revision.
    """

    records_by_id = {record.id: record for record in state.records}
    removed = tuple(records_by_id[selection_id] for selection_id in selection_ids)
    removed_ids = set(selection_ids)
    activation_order = tuple(
        selection_id
        for selection_id in state.activation_order
        if selection_id not in removed_ids
    )
    return (
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label,
            current_selection_id=activation_order[-1] if activation_order else None,
            activation_order=activation_order,
            records=tuple(
                record for record in state.records if record.id not in removed_ids
            ),
        ),
        removed,
    )


def reopen_selection(
    state: SelectionState,
    selection: Selection,
    *,
    expected_revision: int,
) -> SelectionState:
    """Open a resolved selection again, with a fresh snapshot lifecycle.

    ``selection`` comes from the notebook's record. It keeps its ID and label,
    so a label that an open selection already uses cannot reopen.
    """

    _require_revision(state, expected_revision)
    if state.record(selection.id) is not None:
        raise Rejection(
            "selection_already_open",
            "This Lens selection is already open.",
        )
    if len(state.records) >= MAX_SELECTIONS:
        raise Rejection(
            "selection_limit_reached",
            f"Lens supports up to {MAX_SELECTIONS} selections.",
        )
    if any(record.selection.label == selection.label for record in state.records):
        raise Rejection(
            "selection_label_conflict",
            f"An open selection already uses the label {selection.label}.",
        )
    label_number = _selection_label_number(selection.label)
    if label_number > MAX_SELECTION_LABEL:
        raise Rejection(
            "history_not_found",
            "This recorded selection can no longer be reopened.",
        )
    current_selection_id, activation_order = _activated_state(
        selection.id,
        state.activation_order,
    )
    return _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=max(state.next_label, label_number + 1),
            current_selection_id=current_selection_id,
            activation_order=activation_order,
            records=(*state.records, SelectionRecord(selection=selection, image=None)),
        )
    )


def validate_state_admission(state: SelectionState) -> None:
    """Validate the complete synchronized state and compact-reference capacity."""

    active_payload = state.payload()
    size = len(
        json.dumps(
            active_payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    if size > MAX_SELECTION_STATE_BYTES:
        raise ValueError(
            "Lens selection notes and DOM evidence exceed the shared "
            f"{MAX_SELECTION_STATE_BYTES:,}-byte limit."
        )
    validate_reference_capacity(state.selections())


def _admit_state(state: SelectionState) -> SelectionState:
    try:
        validate_state_admission(state)
    except ValueError as error:
        raise Rejection("selection_context_limit", str(error)) from error
    return state


def _require_revision(state: SelectionState, expected_revision: object) -> None:
    if expected_revision != state.revision:
        raise Rejection(
            "revision_conflict",
            "Lens selections changed before this command was applied.",
        )


def _selection_label_number(label: str) -> int:
    return int(label[1:])


def _validate_preserved_snapshot(
    existing: SelectionRecord,
    incoming: SelectionSnapshot,
) -> bool:
    current = existing.selection.snapshot
    if incoming == current and incoming.status != "outdated":
        return False
    if not isinstance(current, (AvailableSnapshot, OutdatedSnapshot)):
        raise Rejection(
            "selection_capture_changed",
            "A pending or failed snapshot cannot be marked outdated.",
        )
    if not isinstance(incoming, OutdatedSnapshot):
        raise Rejection(
            "selection_capture_changed",
            "Preserving an image cannot replace its snapshot metadata.",
        )
    if (
        dict(incoming) != {**dict(current), "status": "outdated"}
        or existing.image is None
    ):
        raise Rejection(
            "selection_capture_changed",
            "An outdated snapshot must retain its original image metadata and bytes.",
        )
    return True


def _selection_edit_activates(existing: Selection, selection: Selection) -> bool:
    return (
        existing.note != selection.note
        or existing.anchor != selection.anchor
        or existing.dom_hint != selection.dom_hint
    )


def _activated_state(
    selection_id: str,
    activation_order: tuple[str, ...],
) -> tuple[str, tuple[str, ...]]:
    return selection_id, tuple(
        item for item in activation_order if item != selection_id
    ) + (selection_id,)
