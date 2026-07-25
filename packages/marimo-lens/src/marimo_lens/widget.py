"""The public marimo-lens anywidget."""

from __future__ import annotations

import logging
import pathlib
import threading
import weakref
from collections.abc import Mapping, Sequence
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, Literal, cast

import anywidget
import traitlets
from pydantic import TypeAdapter, ValidationError

from ._context import build_lens_context
from ._images import ImageError
from ._marimo_runtime import MarimoRuntimeAdapter
from ._output_capture import OutputCaptureMailbox, OutputCaptureResult
from ._protocol import (
    Command,
    ProtocolError,
    cell_activity_event,
    cell_reveal_event,
    error_response,
    is_response_envelope,
    mutation_ack_response,
    parse_capture_browser_event,
    parse_command,
    request_id_from,
    selection_put_response,
    selection_resolved_event,
    snapshot_response,
)
from ._protocol_models import (
    CELL_ID_ADAPTER,
    MAX_SELECTIONS,
    OPTIONAL_ATTENTION_TEXT_ADAPTER,
    OPTIONAL_ACTIVITY_LABEL_ADAPTER,
    REQUEST_ID_ADAPTER,
    REVISION_ADAPTER,
    SELECTION_ID_ADAPTER,
)
from ._selection_state import (
    SelectionStore,
    activate_selection,
    apply_selection_put,
    clear_history,
    clear_selections,
    plan_selection_put,
    remove_selection,
    reopen_selection,
    resolve_selections,
)
from .context import LensContext
from .errors import LensError

_LOGGER = logging.getLogger(__name__)
_STATIC = pathlib.Path(__file__).parent / "static"


class Lens(anywidget.AnyWidget):
    """Collect cell-grounded selections from rendered marimo outputs."""

    _marimo_lens_widget = True
    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    _state = traitlets.Dict(
        default_value={
            "revision": 0,
            "nextLabel": "S1",
            "currentSelectionId": None,
            "selections": [],
            "history": [],
        }
    ).tag(sync=True)

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._lens_closed = False
        self._selection_store = SelectionStore()
        self._runtime = MarimoRuntimeAdapter()
        super().__init__(_state=self._selection_store.state.payload())
        self._output_captures = OutputCaptureMailbox(
            lock=self._lock,
            send=self.send,
            revision=lambda: self._selection_store.state.revision,
            cell_status=self._runtime.cell_status,
        )
        self._bind_comm_close()
        self.on_msg(self._handle_lens_message)

    def context(self) -> LensContext:
        """Return detached selection context from the current marimo runtime.

        Raises:
            LensError: The Lens is closed.
        """

        with self._lock:
            self._require_open()
            state = self._selection_store.state
        runtime = self._runtime.snapshot(
            tuple(str(record.selection["outputCellId"]) for record in state.records)
        )
        return build_lens_context(runtime, state)

    def reveal(self, cell_id: str, *, message: str | None = None) -> None:
        """Reveal one exact notebook cell through the displayed Lens."""

        self._send_cell_attention("reveal", cell_id, message)

    def activity(
        self,
        cell_id: str,
        *,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Mark one exact notebook cell as the agent's active work target."""

        self._send_cell_attention("activity", cell_id, message, label=label)

    def _send_cell_attention(
        self,
        kind: Literal["activity", "reveal"],
        cell_id: str,
        message: str | None,
        *,
        label: str | None = None,
    ) -> None:
        cell_id = _cell_id(cell_id)
        message = _attention_message(message)
        activity_label = _activity_label(label) if kind == "activity" else None
        with self._lock:
            self._require_open()
        cell_status = self._runtime.cell_status(cell_id)
        with self._lock:
            self._require_open()
            revision = self._selection_store.state.revision
            if cell_status == "unavailable":
                raise LensError(
                    "runtime_unavailable",
                    "Lens cannot inspect the active marimo runtime.",
                    revision=revision,
                )
            if cell_status == "missing":
                raise LensError(
                    "cell_not_found",
                    "The active marimo dataflow graph has no cell with this ID.",
                    revision=revision,
                )
            if kind == "activity":
                event = cell_activity_event(
                    cell_id=cell_id,
                    label=activity_label,
                    message=message,
                    revision=revision,
                )
            else:
                event = cell_reveal_event(
                    cell_id=cell_id,
                    message=message,
                    revision=revision,
                )
            with suppress(Exception):
                self.send(event)

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move completed selections into History and return the new revision."""

        normalized_ids = _selection_ids(selection_ids)
        expected_revision = _expected_revision(expected_revision)
        summary = _resolution_summary(summary)

        with self._lock:
            self._require_open()
            current = self._selection_store.state
            try:
                next_state, _removed, addressed = resolve_selections(
                    current,
                    normalized_ids,
                    expected_revision=expected_revision,
                    addressed_at=datetime.now(timezone.utc).isoformat(),
                    summary=summary,
                )
            except ProtocolError as error:
                raise LensError(
                    error.code,
                    str(error),
                    revision=current.revision,
                ) from error
            self._selection_store.commit(next_state, self._publish_state)
            event = selection_resolved_event(
                selections=tuple(
                    {
                        "selectionId": receipt.selection_id,
                        "label": receipt.receipt["label"],
                        "resolutionRevision": receipt.resolution_revision,
                    }
                    for receipt in addressed
                ),
                summary=summary,
                revision=next_state.revision,
            )
            # Serialize presentation events with their mutations so concurrent
            # resolutions reach the browser in revision order.
            with suppress(Exception):
                self.send(event)
            return next_state.revision

    def close(self) -> None:
        """Close the widget and release its in-memory PNG captures."""

        with self._lock:
            if self._lens_closed:
                return
            self._lens_closed = True
            self._output_captures.close()
            self._selection_store.release()
        super().close()

    def _start_output_capture(self, cell_id: str) -> str:
        """Start one transient capture for an agent integration."""

        cell_id = _cell_id(cell_id)
        with self._lock:
            self._require_open()
            selections = tuple(
                {
                    "selectionId": record.id,
                    "label": record.selection["label"],
                    "anchor": record.detached_selection()["anchor"],
                }
                for record in self._selection_store.state.records
                if record.selection["outputCellId"] == cell_id
            )
        return self._output_captures.start(cell_id, selections=selections)

    def _read_output_capture(self, request_id: str) -> OutputCaptureResult:
        """Read or consume one transient agent capture."""

        return self._output_captures.read(
            _validated_identifier(REQUEST_ID_ADAPTER, request_id, name="request_id")
        )

    def _bind_comm_close(self) -> None:
        """Route direct comm disposal through the widget close lifecycle."""

        comm = self.comm
        if comm is None:
            return
        comm_type = type(comm)
        original_close = comm_type.close
        lens_ref = weakref.ref(self)
        comm_ref = weakref.ref(comm)
        pending_close: tuple[tuple[object, ...], dict[str, object]] | None = None

        def close_comm(*args: object, **kwargs: object) -> object:
            nonlocal pending_close
            lens = lens_ref()
            bound_comm = comm_ref()
            if bound_comm is None:
                return None
            if lens is not None:
                with lens._lock:
                    if not lens._lens_closed:
                        pending_close = (args, dict(kwargs))
                        try:
                            lens.close()
                        finally:
                            pending_close = None
                        return None
                    if pending_close is not None:
                        forwarded_args, forwarded_kwargs = pending_close
                        pending_close = None
                        return original_close(
                            bound_comm,
                            *forwarded_args,
                            **forwarded_kwargs,
                        )
            return original_close(bound_comm, *args, **kwargs)

        comm.close = close_comm

    @traitlets.observe("_state")
    def _keep_state_authoritative(self, change: traitlets.Bunch) -> None:
        if not hasattr(self, "_lock") or not hasattr(self, "_selection_store"):
            return
        with self._lock:
            canonical = self._selection_store.state.payload()
            if change.get("new") != canonical:
                self.set_trait("_state", canonical)

    def _handle_lens_message(
        self,
        _widget: object,
        content: object,
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> None:
        try:
            capture_event = parse_capture_browser_event(content, buffers)
        except ProtocolError:
            return
        if capture_event is not None:
            self._output_captures.set_browser_ready(capture_event == "ready")
            return
        if is_response_envelope(content):
            if isinstance(content, Mapping):
                self._output_captures.accept_response(
                    cast(Mapping[str, Any], content),
                    buffers,
                )
            return

        try:
            command = parse_command(content, buffers)
        except ProtocolError as error:
            self.send(
                error_response(
                    request_id=request_id_from(content),
                    revision=self._selection_store.state.revision,
                    code=error.code,
                    message=str(error),
                )
            )
            return
        if command is None:
            return

        response_buffers: tuple[bytes, ...] = ()
        try:
            response, response_buffers = self._execute(command, buffers)
        except (ProtocolError, ImageError) as error:
            response = error_response(
                request_id=command.request_id,
                revision=self._selection_store.state.revision,
                code=error.code,
                message=str(error),
            )
        except Exception:
            _LOGGER.exception("Lens command failed")
            response = error_response(
                request_id=command.request_id,
                revision=self._selection_store.state.revision,
                code="internal_error",
                message="Lens could not apply this command.",
            )
        self.send(response, buffers=list(response_buffers))

    def _execute(
        self,
        command: Command,
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> tuple[dict[str, Any], tuple[bytes, ...]]:
        if command.type == "snapshot.get":
            return self._snapshot_response(command)
        if command.type == "selection.put":
            return self._selection_put_response(command, buffers), ()

        with self._lock:
            self._require_protocol_open()
            current = self._selection_store.state
            if command.type == "selection.activate":
                selection_id = str(command.payload["selectionId"])
                next_state = activate_selection(
                    current,
                    selection_id,
                    expected_revision=int(command.payload["expectedRevision"]),
                )
                response_selection_id: str | None = selection_id
            elif command.type == "selection.delete":
                selection_id = str(command.payload["selectionId"])
                next_state, _removed = remove_selection(
                    current,
                    selection_id,
                    expected_revision=int(command.payload["expectedRevision"]),
                )
                response_selection_id = selection_id
            elif command.type == "selection.reopen":
                selection_id = str(command.payload["selectionId"])
                next_state, _selection = reopen_selection(
                    current,
                    selection_id,
                    int(command.payload["resolutionRevision"]),
                    expected_revision=int(command.payload["expectedRevision"]),
                )
                response_selection_id = selection_id
            elif command.type == "selections.clear":
                next_state = clear_selections(
                    current,
                    expected_revision=int(command.payload["expectedRevision"]),
                )
                response_selection_id = None
            elif command.type == "history.clear":
                next_state = clear_history(
                    current,
                    expected_revision=int(command.payload["expectedRevision"]),
                )
                response_selection_id = None
            else:
                raise ProtocolError(
                    "unsupported_command",
                    "Lens command type is not supported.",
                )
            self._selection_store.commit(next_state, self._publish_state)
            return (
                mutation_ack_response(
                    request_id=command.request_id,
                    revision=next_state.revision,
                    selection_id=response_selection_id,
                ),
                (),
            )

    def _selection_put_response(
        self,
        command: Command,
        buffers: Sequence[bytes | bytearray | memoryview],
    ) -> dict[str, Any]:
        with self._lock:
            self._require_protocol_open()
            plan = plan_selection_put(
                self._selection_store.state,
                command.payload,
            )
            image_buffer = buffers[0] if plan.image_action == "replace" else None
            next_state, committed = apply_selection_put(
                self._selection_store.state,
                plan,
                image_buffer,
                max_total_image_bytes=self._selection_store.max_total_image_bytes,
            )
            self._selection_store.commit(next_state, self._publish_state)
            return selection_put_response(
                request_id=command.request_id,
                revision=next_state.revision,
                selection=committed,
            )

    def _snapshot_response(
        self,
        command: Command,
    ) -> tuple[dict[str, Any], tuple[bytes, ...]]:
        with self._lock:
            self._require_protocol_open()
            state = self._selection_store.state
            selection_id = str(command.payload["selectionId"])
            record = state.record(selection_id)
            image = record.image if record is not None else None
            if image is None:
                raise ProtocolError(
                    "snapshot_not_found",
                    "The selection has no stored snapshot.",
                )
            return snapshot_response(
                request_id=command.request_id,
                revision=state.revision,
                selection_id=selection_id,
                image=image,
            )

    def _publish_state(self, payload: dict[str, Any]) -> None:
        self.set_trait("_state", payload)

    def _require_open(self) -> None:
        if self._lens_closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._selection_store.state.revision,
            )

    def _require_protocol_open(self) -> None:
        if self._lens_closed:
            raise ProtocolError("lens_closed", "Lens is closed.")


def _selection_id(value: object) -> str:
    return _validated_identifier(SELECTION_ID_ADAPTER, value, name="selection_id")


def _selection_ids(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        values: Sequence[object] = (value,)
    elif isinstance(value, Sequence) and not isinstance(
        value,
        (bytes, bytearray, memoryview),
    ):
        values = value
    else:
        raise TypeError("selection_ids must be a string or a sequence of strings.")
    if not values:
        raise ValueError("selection_ids must contain at least one selection ID.")
    if len(values) > MAX_SELECTIONS:
        raise ValueError(
            f"selection_ids must contain at most {MAX_SELECTIONS} selection IDs."
        )
    selection_ids = tuple(_selection_id(item) for item in values)
    if len(selection_ids) != len(set(selection_ids)):
        raise ValueError("selection_ids must not contain duplicates.")
    return selection_ids


def _cell_id(value: object) -> str:
    return _validated_identifier(CELL_ID_ADAPTER, value, name="cell_id")


def _validated_identifier(
    adapter: TypeAdapter[str],
    value: object,
    *,
    name: str,
) -> str:
    try:
        return adapter.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type == "string_type":
            raise TypeError(f"{name} must be a string.") from None
        raise ValueError(f"{name} {message}.") from None


def _expected_revision(value: object) -> int:
    try:
        return REVISION_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, _ = _validation_detail(error)
        if error_type == "int_type":
            raise TypeError("expected_revision must be an integer.") from None
        raise ValueError(
            "expected_revision must be a non-negative integer within JSON's safe range."
        ) from None


def _resolution_summary(value: object) -> str | None:
    return _optional_transient_text(value, name="summary")


def _attention_message(value: object) -> str | None:
    return _optional_transient_text(value, name="message")


def _activity_label(value: object) -> str | None:
    try:
        return OPTIONAL_ACTIVITY_LABEL_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type in {"string_type", "none_required"}:
            raise TypeError("label must be a string or None.") from None
        raise ValueError(f"label {message}.") from None


def _optional_transient_text(
    value: object,
    *,
    name: str,
) -> str | None:
    try:
        return OPTIONAL_ATTENTION_TEXT_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type in {"string_type", "none_required"}:
            raise TypeError(f"{name} must be a string or None.") from None
        raise ValueError(f"{name} {message}.") from None


def _validation_detail(error: ValidationError) -> tuple[str, str]:
    detail = error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )[0]
    return str(detail["type"]), str(detail["msg"])


__all__ = ["Lens"]
