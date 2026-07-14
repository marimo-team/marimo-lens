"""The public marimo Lens anywidget."""

from __future__ import annotations

import copy
import pathlib
import threading
from collections.abc import Mapping, Sequence
from contextlib import suppress
from typing import Any, cast

import traitlets

from ._anywidget_bundle import Bundle, BundledWidget
from ._context import build_context, validate_selection_budget
from ._images import ImageError, ImageStore
from ._protocol import (
    MAX_SELECTIONS,
    Command,
    ProtocolError,
    error_response,
    parse_command,
    request_id_from,
    success_response,
)
from ._runtime import collect_runtime_snapshot
from .context import LensContext

_BUNDLE = Bundle(
    static_dir=pathlib.Path(__file__).parent / "static",
    dev_server_env="MARIMO_LENS_VITE_DEV_SERVER",
)

_IMMUTABLE_SELECTION_FIELDS = ("label", "outputCellId", "createdAt")


class Lens(BundledWidget):
    """Collect cell-grounded selections from rendered marimo outputs."""

    _marimo_lens_widget = True
    bundle = _BUNDLE

    _lens_css = traitlets.Unicode("").tag(sync=True)
    _state = traitlets.Dict(
        default_value={
            "revision": 0,
            "nextLabel": "S1",
            "currentSelectionId": None,
            "selections": [],
        }
    ).tag(sync=True)

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._lens_closed = False
        self._revision = 0
        self._next_label = 1
        self._current_selection_id: str | None = None
        self._activation_order: list[str] = []
        self._selections: list[dict[str, Any]] = []
        self._images = ImageStore()
        super().__init__(_state=self._state_payload())
        self._lens_css = self._css
        # BundledWidget owns bundle module messages. Lens adds an independent
        # callback on the same comm after the bundle callback is registered.
        self.on_msg(self._handle_lens_message)

    def context(self) -> LensContext:
        """Return detached selection context from the current marimo runtime."""

        with self._lock:
            if self._lens_closed:
                raise RuntimeError("Lens is closed.")
            selections = copy.deepcopy(self._selections)
            images = self._images.snapshot(
                [str(selection["id"]) for selection in selections]
            )
            revision = self._revision
            current_selection_id = self._current_selection_id
        runtime = collect_runtime_snapshot()
        references, text = build_context(
            runtime,
            selections,
            revision=revision,
            current_selection_id=current_selection_id,
        )
        return LensContext(
            references=references,
            text=text,
            images=images,
        )

    def close(self) -> None:
        """Close the widget and release its in-memory PNG captures."""

        with self._lock:
            if self._lens_closed:
                return
            self._lens_closed = True
            self._images.clear()
        super().close()

    @traitlets.observe("_state")
    def _keep_state_authoritative(self, change: traitlets.Bunch) -> None:
        if not hasattr(self, "_lock"):
            return
        with self._lock:
            canonical = self._state_payload()
            if change.get("new") != canonical:
                self.set_trait("_state", canonical)

    def _handle_lens_message(
        self,
        _widget: object,
        content: object,
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> None:
        try:
            command = parse_command(content, buffers)
        except ProtocolError as error:
            self.send(
                error_response(
                    request_id=request_id_from(content),
                    revision=self._revision,
                    code=error.code,
                    message=str(error),
                )
            )
            return
        if command is None:
            return

        try:
            response = self._execute(command, buffers)
        except (ProtocolError, ImageError) as error:
            response = error_response(
                request_id=command.request_id,
                revision=self._revision,
                code=error.code,
                message=str(error),
            )
        except Exception as error:
            response = error_response(
                request_id=command.request_id,
                revision=self._revision,
                code="internal_error",
                message=f"{type(error).__name__}: {error}",
            )
        self.send(response)

    def _execute(
        self,
        command: Command,
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> dict[str, Any]:
        if command.type == "context.export":
            context = self.context()
            return success_response(
                request_id=command.request_id,
                revision=cast(int, context.references["revision"]),
                payload={"text": context.text},
            )

        with self._lock:
            if self._lens_closed:
                raise ProtocolError("lens_closed", "Lens is closed.")
            expected_revision = command.payload["expectedRevision"]
            if expected_revision != self._revision:
                raise ProtocolError(
                    "revision_conflict",
                    "Lens selections changed before this command was applied.",
                )
            if command.type == "selection.put":
                selection = self._put_selection(command.payload, buffers)
                payload: Mapping[str, Any] = {"selection": selection}
            elif command.type == "selection.activate":
                selection_id = str(command.payload["selectionId"])
                self._activate_selection(selection_id)
                payload = {"selectionId": selection_id}
            elif command.type == "selection.delete":
                selection_id = str(command.payload["selectionId"])
                self._delete_selection(selection_id)
                payload = {"selectionId": selection_id}
            elif command.type == "selections.clear":
                self._clear_selections()
                payload = {}
            else:
                raise ProtocolError(
                    "unsupported_command",
                    "Lens command type is not supported.",
                )

            return success_response(
                request_id=command.request_id,
                revision=self._revision,
                payload=payload,
            )

    def _put_selection(
        self,
        payload: Mapping[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> dict[str, Any]:
        selection = copy.deepcopy(dict(payload["selection"]))
        selection_id = str(selection["id"])
        image_action = str(payload["imageAction"])
        existing_index = next(
            (
                index
                for index, item in enumerate(self._selections)
                if item["id"] == selection_id
            ),
            None,
        )
        existing = (
            self._selections[existing_index] if existing_index is not None else None
        )

        if existing is None and len(self._selections) >= MAX_SELECTIONS:
            raise ProtocolError(
                "selection_limit_reached",
                f"Lens supports up to {MAX_SELECTIONS} selections.",
            )
        if existing is None and selection["label"] != f"S{self._next_label}":
            raise ProtocolError(
                "selection_label_conflict",
                f"The next Lens selection label is S{self._next_label}.",
            )
        if existing is not None:
            for field in _IMMUTABLE_SELECTION_FIELDS:
                if selection[field] != existing[field]:
                    raise ProtocolError(
                        "selection_identity_changed",
                        f"Selection {field} cannot change after creation.",
                    )
        elif image_action == "preserve":
            raise ProtocolError(
                "selection_not_found",
                "A new selection cannot preserve an image.",
            )

        outdated_transition = False
        if existing is not None and image_action == "preserve":
            outdated_transition = self._validate_preserved_snapshot(
                selection_id,
                existing["snapshot"],
                selection["snapshot"],
            )
            if not outdated_transition and any(
                selection.get(field) != existing.get(field)
                for field in ("anchor", "domHint")
            ):
                raise ProtocolError(
                    "selection_capture_changed",
                    "Changing selection geometry must mark its retained snapshot outdated.",
                )

        if image_action == "replace":
            snapshot_metadata = selection["snapshot"]
            prepared_image = self._images.prepare(
                selection_id,
                snapshot_metadata,
                buffers[0],
            )
        else:
            prepared_image = None

        next_selections = copy.deepcopy(self._selections)
        if existing_index is None:
            next_selections.append(selection)
        else:
            next_selections[existing_index] = selection

        should_activate = existing is None or (
            existing is not None and self._selection_edit_activates(existing, selection)
        )
        next_current_selection_id = self._current_selection_id
        next_activation_order = list(self._activation_order)
        if should_activate:
            next_current_selection_id, next_activation_order = self._activated_state(
                selection_id,
                next_activation_order,
            )

        previous_image = self._images.get(selection_id)
        if prepared_image is not None:
            self._images.replace(prepared_image)
        elif image_action == "clear":
            self._images.remove(selection_id)
        elif outdated_transition:
            self._images.mark_outdated(selection_id)
        try:
            self._commit_selections(
                next_selections,
                current_selection_id=next_current_selection_id,
                activation_order=next_activation_order,
                advance_label=existing is None,
            )
        except Exception:
            self._restore_image(selection_id, previous_image)
            raise
        return copy.deepcopy(selection)

    def _validate_preserved_snapshot(
        self,
        selection_id: str,
        existing: Mapping[str, Any],
        incoming: Mapping[str, Any],
    ) -> bool:
        if incoming == existing and incoming.get("status") != "outdated":
            return False
        existing_status = existing.get("status")
        if existing_status not in {"available", "outdated"}:
            raise ProtocolError(
                "selection_capture_changed",
                "A pending or failed snapshot cannot be marked outdated.",
            )
        if incoming.get("status") != "outdated":
            raise ProtocolError(
                "selection_capture_changed",
                "Preserving an image cannot replace its snapshot metadata.",
            )
        expected = dict(existing)
        expected["status"] = "outdated"
        if incoming != expected or self._images.get(selection_id) is None:
            raise ProtocolError(
                "selection_capture_changed",
                "An outdated snapshot must retain its original image metadata and bytes.",
            )
        return True

    @staticmethod
    def _selection_edit_activates(
        existing: Mapping[str, Any],
        selection: Mapping[str, Any],
    ) -> bool:
        return any(
            existing.get(field) != selection.get(field)
            for field in ("note", "anchor", "domHint")
        )

    def _activate_selection(self, selection_id: str) -> None:
        if not any(item["id"] == selection_id for item in self._selections):
            raise ProtocolError(
                "selection_not_found",
                "Cannot activate an unknown Lens selection.",
            )
        current_selection_id, activation_order = self._activated_state(
            selection_id,
            list(self._activation_order),
        )
        self._commit_selections(
            copy.deepcopy(self._selections),
            current_selection_id=current_selection_id,
            activation_order=activation_order,
        )

    def _delete_selection(self, selection_id: str) -> None:
        if not any(item["id"] == selection_id for item in self._selections):
            raise ProtocolError(
                "selection_not_found",
                "Cannot delete an unknown Lens selection.",
            )
        previous_image = self._images.get(selection_id)
        next_selections = [
            item for item in self._selections if item["id"] != selection_id
        ]
        next_activation_order = [
            item for item in self._activation_order if item != selection_id
        ]
        next_current_selection_id = self._current_selection_id
        if next_current_selection_id == selection_id:
            next_current_selection_id = (
                next_activation_order[-1] if next_activation_order else None
            )
        self._images.remove(selection_id)
        try:
            self._commit_selections(
                next_selections,
                current_selection_id=next_current_selection_id,
                activation_order=next_activation_order,
            )
        except Exception:
            self._restore_image(selection_id, previous_image)
            raise

    def _clear_selections(self) -> None:
        previous_images = self._images.snapshot(
            [str(selection["id"]) for selection in self._selections]
        )
        self._images.clear()
        try:
            self._commit_selections(
                [],
                current_selection_id=None,
                activation_order=[],
            )
        except Exception:
            for image in previous_images:
                self._images.replace(image)
            raise

    def _commit_selections(
        self,
        selections: list[dict[str, Any]],
        *,
        current_selection_id: str | None,
        activation_order: list[str],
        advance_label: bool = False,
    ) -> None:
        try:
            validate_selection_budget(selections)
        except ValueError as error:
            raise ProtocolError("selection_context_limit", str(error)) from error

        selection_ids = [str(selection["id"]) for selection in selections]
        selection_id_set = set(selection_ids)
        if len(selection_ids) != len(selection_id_set):
            raise RuntimeError("Selection ids must be unique.")
        if (
            current_selection_id is not None
            and current_selection_id not in selection_id_set
        ):
            raise RuntimeError("The current selection must exist in Lens state.")
        if (
            len(activation_order) != len(set(activation_order))
            or set(activation_order) != selection_id_set
        ):
            raise RuntimeError(
                "Selection activation order must cover Lens state exactly."
            )

        previous_selections = self._selections
        previous_revision = self._revision
        previous_next_label = self._next_label
        previous_current_selection_id = self._current_selection_id
        previous_activation_order = self._activation_order
        self._selections = copy.deepcopy(selections)
        self._revision += 1
        if advance_label:
            self._next_label += 1
        self._current_selection_id = current_selection_id
        self._activation_order = list(activation_order)
        try:
            self.set_trait("_state", self._state_payload())
        except Exception:
            self._selections = previous_selections
            self._revision = previous_revision
            self._next_label = previous_next_label
            self._current_selection_id = previous_current_selection_id
            self._activation_order = previous_activation_order
            with suppress(Exception):
                self.set_trait("_state", self._state_payload())
            raise

    @staticmethod
    def _activated_state(
        selection_id: str,
        activation_order: list[str],
    ) -> tuple[str, list[str]]:
        return selection_id, [
            item for item in activation_order if item != selection_id
        ] + [selection_id]

    def _restore_image(self, selection_id: str, image: Any) -> None:
        if image is None:
            self._images.remove(selection_id)
        else:
            self._images.replace(image)

    def _state_payload(self) -> dict[str, Any]:
        return {
            "revision": self._revision,
            "nextLabel": f"S{self._next_label}",
            "currentSelectionId": self._current_selection_id,
            "selections": copy.deepcopy(self._selections),
        }


__all__ = ["Lens"]
