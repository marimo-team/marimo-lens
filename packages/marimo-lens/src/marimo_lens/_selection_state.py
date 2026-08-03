"""Immutable selection state and revision-checked transitions."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Any, cast

from pydantic import ValidationError

from ._images import MAX_TOTAL_IMAGE_BYTES, _SelectionImage, prepare_selection_image
from ._protocol import MAX_HISTORY, MAX_SELECTIONS, ProtocolError
from ._protocol_models import (
    ADDRESSED_SELECTION_ADAPTER,
    POSITIVE_SAFE_INTEGER_ADAPTER,
    REVISION_ADAPTER,
    SELECTION_ADAPTER,
    SELECTION_LABEL_ADAPTER,
    AvailableSnapshot,
    OutdatedSnapshot,
)
from ._references import validate_reference_capacity

_IMMUTABLE_SELECTION_FIELDS = ("label", "outputCellId", "createdAt")
MAX_SELECTION_STATE_BYTES = 40_000
MAX_HISTORY_STATE_BYTES = 64_000


class _StateRestoreError(RuntimeError):
    """The previous selection state could not be republished."""


@dataclass(frozen=True, slots=True)
class SelectionRecord:
    """One selection and every resource that shares its lifetime."""

    selection: Mapping[str, Any]
    image: _SelectionImage | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "selection", _freeze_mapping(self.selection))

    @property
    def id(self) -> str:
        return cast(str, self.selection["id"])

    def detached_selection(self) -> dict[str, Any]:
        return cast(dict[str, Any], _thaw(self.selection))


@dataclass(frozen=True, slots=True)
class AddressedSelectionRecord:
    """One immutable completion receipt for a human selection."""

    receipt: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "receipt", _freeze_mapping(self.receipt))
        try:
            ADDRESSED_SELECTION_ADAPTER.validate_python(_thaw(self.receipt))
        except ValidationError:
            raise RuntimeError("Addressed selection record is invalid.") from None

    @property
    def selection_id(self) -> str:
        return cast(str, self.receipt["selectionId"])

    @property
    def resolution_revision(self) -> int:
        return cast(int, self.receipt["resolutionRevision"])

    def detached_receipt(self) -> dict[str, Any]:
        return cast(dict[str, Any], _thaw(self.receipt))


@dataclass(frozen=True, slots=True)
class SelectionState:
    """One authoritative selection aggregate."""

    revision: int = 0
    next_label: int = 1
    current_selection_id: str | None = None
    activation_order: tuple[str, ...] = ()
    records: tuple[SelectionRecord, ...] = ()
    history: tuple[AddressedSelectionRecord, ...] = ()

    def __post_init__(self) -> None:
        try:
            REVISION_ADAPTER.validate_python(self.revision)
        except ValidationError:
            raise RuntimeError(
                "Selection revision must be a non-negative integer."
            ) from None
        try:
            POSITIVE_SAFE_INTEGER_ADAPTER.validate_python(self.next_label)
        except ValidationError:
            raise RuntimeError(
                "The next selection label must be a positive integer."
            ) from None
        if any(not isinstance(record, SelectionRecord) for record in self.records):
            raise RuntimeError(
                "Selection state records must be SelectionRecord values."
            )
        if any(
            not isinstance(record, AddressedSelectionRecord) for record in self.history
        ):
            raise RuntimeError(
                "Selection history records must be AddressedSelectionRecord values."
            )
        if len(self.history) > MAX_HISTORY:
            raise RuntimeError(
                f"Selection history supports up to {MAX_HISTORY} receipts."
            )
        for record in self.records:
            _validate_record(record)
        history_revisions = tuple(record.resolution_revision for record in self.history)
        history_keys = tuple(
            (record.selection_id, record.resolution_revision) for record in self.history
        )
        if (
            len(history_keys) != len(set(history_keys))
            or any(revision > self.revision for revision in history_revisions)
            or history_revisions != tuple(sorted(history_revisions))
        ):
            raise RuntimeError(
                "Selection history must use unique selection revisions in order."
            )
        selection_ids = tuple(record.id for record in self.records)
        selection_id_set = set(selection_ids)
        if len(selection_ids) != len(selection_id_set):
            raise RuntimeError("Selection ids must be unique.")
        if (
            self.current_selection_id is not None
            and self.current_selection_id not in selection_id_set
        ):
            raise RuntimeError("The current selection must exist in Lens state.")
        if (
            len(self.activation_order) != len(set(self.activation_order))
            or set(self.activation_order) != selection_id_set
        ):
            raise RuntimeError(
                "Selection activation order must cover Lens state exactly."
            )
        if bool(self.records) != (self.current_selection_id is not None):
            raise RuntimeError("Nonempty Lens state must have a current selection.")
        if self.records and self.activation_order[-1] != self.current_selection_id:
            raise RuntimeError("The current selection must be most recently active.")
        labels = tuple(record.selection.get("label") for record in self.records)
        label_numbers = tuple(_selection_label_number(label) for label in labels)
        if len(labels) != len(set(labels)):
            raise RuntimeError("Selection labels must be unique.")
        if any(label_number >= self.next_label for label_number in label_numbers):
            raise RuntimeError(
                "The next selection label must follow every allocated label."
            )

    def record(self, selection_id: str) -> SelectionRecord | None:
        return next(
            (record for record in self.records if record.id == selection_id),
            None,
        )

    def selections(self) -> list[dict[str, Any]]:
        return [record.detached_selection() for record in self.records]

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
        return {
            "revision": self.revision,
            "nextLabel": f"S{self.next_label}",
            "currentSelectionId": self.current_selection_id,
            "selections": self.selections(),
            "history": [record.detached_receipt() for record in self.history],
        }


class SelectionStore:
    """Own the current immutable state pointer and atomic publication."""

    __slots__ = ("_max_total_image_bytes", "_state")

    def __init__(
        self,
        *,
        max_total_image_bytes: int = MAX_TOTAL_IMAGE_BYTES,
    ) -> None:
        self._state = SelectionState()
        self._max_total_image_bytes = max_total_image_bytes

    @property
    def state(self) -> SelectionState:
        return self._state

    @property
    def max_total_image_bytes(self) -> int:
        return self._max_total_image_bytes

    def commit(
        self,
        state: SelectionState,
        publish: Callable[[dict[str, Any]], None],
    ) -> None:
        previous = self._state
        if state.revision != previous.revision + 1:
            raise RuntimeError("Selection commits must advance exactly one revision.")
        self._state = state
        try:
            publish(state.payload())
        except Exception as publish_error:
            self._state = previous
            try:
                _restore_published_state(publish, previous.payload())
            except _StateRestoreError:
                publish_error.add_note(
                    "Lens restored local selection state but could not republish it."
                )
            raise

    def release(self) -> None:
        state = self._state
        self._state = SelectionState(
            revision=state.revision,
            next_label=state.next_label,
        )


def _restore_published_state(
    publish: Callable[[dict[str, Any]], None],
    payload: dict[str, Any],
) -> None:
    try:
        publish(payload)
    except Exception as error:
        raise _StateRestoreError from error


@dataclass(frozen=True, slots=True)
class SelectionPutPlan:
    base_revision: int
    selection: Mapping[str, Any]
    image_action: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "selection", _freeze_mapping(self.selection))


def plan_selection_put(
    state: SelectionState,
    payload: Mapping[str, Any],
) -> SelectionPutPlan:
    """Validate one put against the authoritative selection state."""

    _require_revision(state, payload["expectedRevision"])
    selection = cast(dict[str, Any], _thaw(payload["selection"]))
    selection_id = str(selection["id"])
    image_action = str(payload["imageAction"])
    existing = state.record(selection_id)

    if existing is None and len(state.records) >= MAX_SELECTIONS:
        raise ProtocolError(
            "selection_limit_reached",
            f"Lens supports up to {MAX_SELECTIONS} selections.",
        )
    if existing is None and selection["label"] != f"S{state.next_label}":
        raise ProtocolError(
            "selection_label_conflict",
            f"The next Lens selection label is S{state.next_label}.",
        )
    if existing is not None:
        for field in _IMMUTABLE_SELECTION_FIELDS:
            if selection[field] != existing.selection[field]:
                raise ProtocolError(
                    "selection_identity_changed",
                    f"Selection {field} cannot change after creation.",
                )
        previous_resolution = existing.selection.get("previousResolution")
        if previous_resolution is not None:
            selection["previousResolution"] = _thaw(previous_resolution)
    elif image_action == "preserve":
        raise ProtocolError(
            "selection_not_found",
            "A new selection cannot preserve an image.",
        )

    if existing is not None and image_action == "preserve":
        outdated_transition = _validate_preserved_snapshot(
            existing,
            cast(Mapping[str, Any], selection["snapshot"]),
        )
        if not outdated_transition and any(
            selection.get(field) != existing.selection.get(field)
            for field in ("anchor", "domHint")
        ):
            raise ProtocolError(
                "selection_capture_changed",
                "Changing selection geometry must mark its retained snapshot outdated.",
            )

    return SelectionPutPlan(
        base_revision=state.revision,
        selection=selection,
        image_action=image_action,
    )


def apply_selection_put(
    state: SelectionState,
    plan: SelectionPutPlan,
    image_buffer: bytes | bytearray | memoryview | None,
    *,
    max_total_image_bytes: int = MAX_TOTAL_IMAGE_BYTES,
) -> tuple[SelectionState, dict[str, Any]]:
    """Return the state produced by one validated put command."""

    if plan.base_revision != state.revision:
        raise ProtocolError(
            "revision_conflict",
            "Lens selections changed before this command was applied.",
        )
    selection = cast(dict[str, Any], _thaw(plan.selection))
    selection_id = str(selection["id"])
    image_action = plan.image_action
    existing_index = next(
        (
            index
            for index, record in enumerate(state.records)
            if record.id == selection_id
        ),
        None,
    )
    existing = state.records[existing_index] if existing_index is not None else None

    outdated_transition = False
    if existing is not None and image_action == "preserve":
        outdated_transition = _validate_preserved_snapshot(
            existing,
            cast(Mapping[str, Any], selection["snapshot"]),
        )
        if not outdated_transition and any(
            selection.get(field) != existing.selection.get(field)
            for field in ("anchor", "domHint")
        ):
            raise ProtocolError(
                "selection_capture_changed",
                "Changing selection geometry must mark its retained snapshot outdated.",
            )

    if image_action == "replace":
        if image_buffer is None:
            raise RuntimeError("A replacement selection image requires PNG bytes.")
        current_image_bytes = (
            len(existing.image.data) if existing and existing.image else 0
        )
        image = prepare_selection_image(
            selection_id,
            cast(Mapping[str, Any], selection["snapshot"]),
            image_buffer,
            other_bytes=state.image_bytes - current_image_bytes,
            max_total_bytes=max_total_image_bytes,
        )
    elif image_action == "clear":
        image = None
    else:
        image = existing.image if existing is not None else None
        if image is not None and outdated_transition and not image.outdated:
            image = replace(image, outdated=True)

    record = SelectionRecord(selection=selection, image=image)
    records = list(state.records)
    if existing_index is None:
        records.append(record)
    else:
        records[existing_index] = record

    should_activate = existing is None or _selection_edit_activates(
        existing.selection,
        selection,
    )
    current_selection_id = state.current_selection_id
    activation_order = state.activation_order
    if should_activate:
        current_selection_id, activation_order = _activated_state(
            selection_id,
            activation_order,
        )

    next_state = _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label + (1 if existing is None else 0),
            current_selection_id=current_selection_id,
            activation_order=activation_order,
            records=tuple(records),
            history=state.history,
        )
    )
    return (
        next_state,
        cast(dict[str, Any], _thaw(record.selection)),
    )


def activate_selection(
    state: SelectionState,
    selection_id: str,
    *,
    expected_revision: int,
) -> SelectionState:
    _require_revision(state, expected_revision)
    if state.record(selection_id) is None:
        raise ProtocolError(
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
            history=state.history,
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
        raise ProtocolError(
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
                history=state.history,
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
            history=state.history,
        )
    )


def resolve_selections(
    state: SelectionState,
    selection_ids: Sequence[str],
    *,
    expected_revision: int,
    addressed_at: str,
    summary: str | None,
) -> tuple[
    SelectionState,
    tuple[SelectionRecord, ...],
    tuple[AddressedSelectionRecord, ...],
]:
    """Move one or more active selections into addressed history atomically."""

    _require_revision(state, expected_revision)
    ids = tuple(selection_ids)
    if not ids:
        raise ProtocolError(
            "invalid_selection",
            "Resolving selections requires at least one selection ID.",
        )
    if len(ids) > MAX_SELECTIONS:
        raise ProtocolError(
            "invalid_selection",
            f"Lens resolves up to {MAX_SELECTIONS} selections at once.",
        )
    if len(ids) != len(set(ids)):
        raise ProtocolError(
            "invalid_selection",
            "Selection IDs in one resolution must be unique.",
        )
    records_by_id = {record.id: record for record in state.records}
    missing = next(
        (selection_id for selection_id in ids if selection_id not in records_by_id),
        None,
    )
    if missing is not None:
        raise ProtocolError(
            "selection_not_found",
            "Cannot resolve an unknown Lens selection.",
        )

    removed = tuple(records_by_id[selection_id] for selection_id in ids)
    removed_ids = set(ids)
    records = tuple(record for record in state.records if record.id not in removed_ids)
    activation_order = tuple(
        selection_id
        for selection_id in state.activation_order
        if selection_id not in removed_ids
    )
    current_selection_id = activation_order[-1] if activation_order else None
    resolution_revision = state.revision + 1
    addressed = tuple(
        _addressed_selection(
            record,
            addressed_at=addressed_at,
            resolution_revision=resolution_revision,
            summary=summary,
        )
        for record in removed
    )
    history = _trim_history(
        (*state.history, *addressed),
        required_tail=len(addressed),
    )
    return (
        _admit_state(
            SelectionState(
                revision=resolution_revision,
                next_label=state.next_label,
                current_selection_id=current_selection_id,
                activation_order=activation_order,
                records=records,
                history=history,
            )
        ),
        removed,
        addressed,
    )


def reopen_selection(
    state: SelectionState,
    selection_id: str,
    resolution_revision: int,
    *,
    expected_revision: int,
) -> tuple[SelectionState, dict[str, Any]]:
    """Restore one addressed selection with a fresh snapshot lifecycle."""

    _require_revision(state, expected_revision)
    if state.record(selection_id) is not None:
        raise ProtocolError(
            "selection_already_open",
            "This Lens selection is already open.",
        )
    if len(state.records) >= MAX_SELECTIONS:
        raise ProtocolError(
            "selection_limit_reached",
            f"Lens supports up to {MAX_SELECTIONS} selections.",
        )
    addressed = next(
        (
            record
            for record in state.history
            if record.selection_id == selection_id
            and record.resolution_revision == resolution_revision
        ),
        None,
    )
    if addressed is None:
        raise ProtocolError(
            "history_not_found",
            "This addressed Lens selection is no longer in history.",
        )

    receipt = addressed.receipt
    selection: dict[str, Any] = {
        "id": receipt["selectionId"],
        "label": receipt["label"],
        "note": receipt["note"],
        "outputCellId": receipt["outputCellId"],
        "createdAt": receipt["createdAt"],
        "anchor": _thaw(receipt["anchor"]),
        "snapshot": {"status": "pending"},
        "previousResolution": {
            "addressedAt": receipt["addressedAt"],
            **(
                {"summary": receipt["summary"]}
                if receipt.get("summary") is not None
                else {}
            ),
        },
    }
    if receipt.get("domHint") is not None:
        selection["domHint"] = _thaw(receipt["domHint"])
    record = SelectionRecord(selection=selection, image=None)
    current_selection_id, activation_order = _activated_state(
        selection_id,
        state.activation_order,
    )
    next_state = _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label,
            current_selection_id=current_selection_id,
            activation_order=activation_order,
            records=(*state.records, record),
            history=state.history,
        )
    )
    return next_state, record.detached_selection()


def clear_history(
    state: SelectionState,
    *,
    expected_revision: int,
) -> SelectionState:
    """Clear addressed receipts while preserving open selections."""

    _require_revision(state, expected_revision)
    records: list[SelectionRecord] = []
    for record in state.records:
        selection = record.detached_selection()
        selection.pop("previousResolution", None)
        records.append(SelectionRecord(selection=selection, image=record.image))
    return _admit_state(
        SelectionState(
            revision=state.revision + 1,
            next_label=state.next_label,
            current_selection_id=state.current_selection_id,
            activation_order=state.activation_order,
            records=tuple(records),
        )
    )


def validate_selection_admission(
    selections: Sequence[Mapping[str, Any]],
) -> None:
    """Validate detached selections and required compact-reference capacity."""

    size = len(
        json.dumps(
            list(selections),
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
    validate_reference_capacity(selections)


def validate_state_admission(state: SelectionState) -> None:
    """Validate the complete synchronized state and compact-reference capacity."""

    active_payload = state.payload()
    active_payload["history"] = []
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
    if _history_size(state.history) > MAX_HISTORY_STATE_BYTES:
        raise ValueError(
            "Lens addressed history exceeds the shared "
            f"{MAX_HISTORY_STATE_BYTES:,}-byte limit."
        )


def _admit_state(state: SelectionState) -> SelectionState:
    try:
        validate_state_admission(state)
    except ValueError as error:
        raise ProtocolError("selection_context_limit", str(error)) from error
    return state


def _require_revision(state: SelectionState, expected_revision: object) -> None:
    if expected_revision != state.revision:
        raise ProtocolError(
            "revision_conflict",
            "Lens selections changed before this command was applied.",
        )


def _validate_record(record: SelectionRecord) -> None:
    try:
        selection = SELECTION_ADAPTER.validate_python(_thaw(record.selection))
    except ValidationError as error:
        raise RuntimeError("Selection record is invalid.") from error
    snapshot = selection.snapshot
    image = record.image
    if isinstance(snapshot, (AvailableSnapshot, OutdatedSnapshot)):
        if image is None or image.selection_id != record.id:
            raise RuntimeError("Available selection snapshots require matching bytes.")
        if (
            snapshot.id != image.id
            or snapshot.width != image.width
            or snapshot.height != image.height
            or snapshot.sha256 != image.sha256
            or snapshot.captured_at != image.captured_at
            or isinstance(snapshot, OutdatedSnapshot) != image.outdated
        ):
            raise RuntimeError("Selection snapshot metadata must match its image.")
    elif image is not None:
        raise RuntimeError("Pending and failed snapshots cannot retain image bytes.")


def _selection_label_number(value: object) -> int:
    try:
        label = SELECTION_LABEL_ADAPTER.validate_python(value)
    except ValidationError:
        raise RuntimeError("Selection labels must use the S<n> format.") from None
    return int(label[1:])


def _validate_preserved_snapshot(
    existing: SelectionRecord,
    incoming: Mapping[str, Any],
) -> bool:
    current = cast(Mapping[str, Any], existing.selection["snapshot"])
    if incoming == current and incoming.get("status") != "outdated":
        return False
    if current.get("status") not in {"available", "outdated"}:
        raise ProtocolError(
            "selection_capture_changed",
            "A pending or failed snapshot cannot be marked outdated.",
        )
    if incoming.get("status") != "outdated":
        raise ProtocolError(
            "selection_capture_changed",
            "Preserving an image cannot replace its snapshot metadata.",
        )
    expected = cast(dict[str, Any], _thaw(current))
    expected["status"] = "outdated"
    if incoming != expected or existing.image is None:
        raise ProtocolError(
            "selection_capture_changed",
            "An outdated snapshot must retain its original image metadata and bytes.",
        )
    return True


def _selection_edit_activates(
    existing: Mapping[str, Any],
    selection: Mapping[str, Any],
) -> bool:
    return any(
        existing.get(field) != selection.get(field)
        for field in ("note", "anchor", "domHint")
    )


def _addressed_selection(
    record: SelectionRecord,
    *,
    addressed_at: str,
    resolution_revision: int,
    summary: str | None,
) -> AddressedSelectionRecord:
    receipt: dict[str, Any] = {
        "selectionId": record.id,
        "label": record.selection["label"],
        "note": record.selection["note"],
        "outputCellId": record.selection["outputCellId"],
        "createdAt": record.selection["createdAt"],
        "addressedAt": addressed_at,
        "anchor": _thaw(record.selection["anchor"]),
        "resolutionRevision": resolution_revision,
    }
    dom_hint = record.selection.get("domHint")
    if dom_hint is not None:
        receipt["domHint"] = _thaw(dom_hint)
    if summary is not None:
        receipt["summary"] = summary
    return AddressedSelectionRecord(receipt)


def _trim_history(
    records: Sequence[AddressedSelectionRecord],
    *,
    required_tail: int = 1,
) -> tuple[AddressedSelectionRecord, ...]:
    if required_tail > MAX_HISTORY:
        raise ProtocolError(
            "selection_context_limit",
            "This Lens completion exceeds the addressed history limit.",
        )
    history = tuple(records[-MAX_HISTORY:])
    while (
        len(history) > required_tail
        and _history_size(history) > MAX_HISTORY_STATE_BYTES
    ):
        history = history[1:]
    if _history_size(history) > MAX_HISTORY_STATE_BYTES:
        raise ProtocolError(
            "selection_context_limit",
            "This Lens completion receipt exceeds the addressed history limit.",
        )
    return history


def _history_size(records: Sequence[AddressedSelectionRecord]) -> int:
    return len(
        json.dumps(
            [record.detached_receipt() for record in records],
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _activated_state(
    selection_id: str,
    activation_order: tuple[str, ...],
) -> tuple[str, tuple[str, ...]]:
    return selection_id, tuple(
        item for item in activation_order if item != selection_id
    ) + (selection_id,)


def _freeze_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _freeze_mapping(value)
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


__all__ = [
    "MAX_HISTORY_STATE_BYTES",
    "MAX_SELECTION_STATE_BYTES",
    "AddressedSelectionRecord",
    "SelectionPutPlan",
    "SelectionRecord",
    "SelectionState",
    "SelectionStore",
    "activate_selection",
    "apply_selection_put",
    "clear_history",
    "clear_selections",
    "plan_selection_put",
    "remove_selection",
    "reopen_selection",
    "resolve_selections",
    "validate_selection_admission",
    "validate_state_admission",
]
