"""The public marimo-lens anywidget."""

from __future__ import annotations

import logging
import pathlib
import threading
import uuid
import weakref
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, cast

import anywidget
import traitlets
from pydantic import TypeAdapter, ValidationError

from ._context import build_lens_context, target_cell_ids
from ._images import ImageError
from ._marimo_runtime import MarimoRuntimeAdapter, current_runtime_scope
from ._output_capture import OutputCaptureSlot
from ._protocol import (
    Command,
    ProtocolError,
    attention_activity_start_event,
    attention_activity_stop_event,
    attention_reveal_event,
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
    ATTENTION_DURATION_ADAPTER,
    CELL_ID_ADAPTER,
    DOM_SELECTOR_ADAPTER,
    MAX_ATTENTION_DURATION_MS,
    MAX_SELECTIONS,
    OPTIONAL_ATTENTION_LABEL_ADAPTER,
    OPTIONAL_ATTENTION_TEXT_ADAPTER,
    OPTIONAL_REVEAL_TEXT_ADAPTER,
    REVISION_ADAPTER,
    SELECTION_ID_ADAPTER,
    AttentionAddress,
    CellAttentionAddress,
    SelectionAttentionAddress,
)
from ._registry import register_lens, unregister_lens
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
from .activity import ActivityHandle
from .context import LensContext, SelectionReference
from .errors import LensError

_LOGGER = logging.getLogger(__name__)
_STATIC = pathlib.Path(__file__).parent / "static"


class Lens(anywidget.AnyWidget):
    """Collect grounded selections from notebook outputs and configured DOM roots."""

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
    _selector = traitlets.Unicode(default_value=None, allow_none=True).tag(sync=True)

    def __init__(
        self,
        *,
        dom_selector: str | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._lens_closed = True
        selector = _validated_dom_selector(dom_selector)
        self._lens_closed = False
        self._dom_selector = selector
        # One kernel model may be rendered by several browser consumers.
        self._browser_views = 0
        self._selection_store = SelectionStore()
        self._runtime = MarimoRuntimeAdapter()
        super().__init__(
            _state=self._selection_store.state.payload(),
            _selector=selector,
        )
        self._output_capture = OutputCaptureSlot(
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
            target_cell_ids(state.selections(), state.current_selection_id)
        )
        return build_lens_context(runtime, state)

    def reveal(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None = None,
        duration_ms: int,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Reveal an exact cell or stored selection for the supplied hold.

        A SelectionReference requires its captured expected_revision. A cell ID
        may omit the revision and must belong to the current marimo graph.
        """

        reveal_message = _reveal_message(message)
        attention_label = _attention_label(label)
        reveal_duration = _validated_duration_ms(duration_ms)
        self._send_attention(
            target,
            expected_revision=expected_revision,
            event=lambda address: attention_reveal_event(
                address=address,
                label=attention_label,
                message=reveal_message,
                duration_ms=reveal_duration,
            ),
        )

    def start_activity(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None = None,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> ActivityHandle:
        """Mark an exact cell or stored selection and return its activity owner.

        A SelectionReference requires its captured expected_revision. The
        returned JSON-safe handle stops this activity when it still owns the
        browser presentation.
        """

        activity_id = uuid.uuid4().hex
        activity_message = _attention_message(message)
        attention_label = _attention_label(label)
        activity_duration = (
            _validated_duration_ms(duration_ms) if duration_ms is not None else None
        )
        self._send_attention(
            target,
            expected_revision=expected_revision,
            event=lambda address: attention_activity_start_event(
                activity_id=activity_id,
                address=address,
                duration_ms=activity_duration,
                label=attention_label,
                message=activity_message,
            ),
        )
        return ActivityHandle(activity_id)

    def stop_activity(self, activity: ActivityHandle) -> None:
        """Stop activity when ``activity`` still owns the presentation.

        The handle may cross a JSON round trip. A non-current handle has no
        effect.
        """

        activity_id = _activity_id(activity)
        with self._lock:
            self._require_open()
            event = attention_activity_stop_event(activity_id=activity_id)
            with suppress(Exception):
                self.send(event)

    def _send_attention(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None,
        event: Callable[[AttentionAddress], dict[str, Any]],
    ) -> None:
        address, expected_revision = _attention_address(
            target,
            expected_revision=expected_revision,
        )
        cell_status: str | None = None
        if isinstance(address, CellAttentionAddress):
            with self._lock:
                self._require_open()
            cell_status = self._runtime.cell_status(address.cell_id)
        with self._lock:
            self._require_open()
            state = self._selection_store.state
            revision = state.revision
            if expected_revision is not None and revision != expected_revision:
                raise _revision_conflict(expected_revision, revision)
            if isinstance(address, SelectionAttentionAddress):
                if state.record(address.selection_id) is None:
                    raise LensError(
                        "selection_not_found",
                        "The Lens selection does not exist.",
                        revision=revision,
                    )
            elif cell_status == "unavailable":
                raise LensError(
                    "runtime_unavailable",
                    "Lens cannot inspect the active marimo runtime.",
                    revision=revision,
                )
            elif cell_status == "missing":
                raise LensError(
                    "cell_not_found",
                    "The active marimo dataflow graph has no cell with this ID.",
                    revision=revision,
                )
            with suppress(Exception):
                self.send(event(address))

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
            self._output_capture.close()
            self._selection_store.release()
        unregister_lens(self)
        super().close()

    def _cell_image(
        self,
        cell_id: str,
        *,
        expected_revision: int,
    ) -> bytes | None:
        """Return current cell PNG bytes across consecutive kernel calls."""

        cell_id = _cell_id(cell_id)
        expected_revision = _expected_revision(expected_revision)
        with self._lock:
            self._require_open()
            state = self._selection_store.state
            if state.revision != expected_revision:
                raise LensError(
                    "revision_conflict",
                    (
                        f"Expected Lens revision {expected_revision}, "
                        f"but the current revision is {state.revision}."
                    ),
                    revision=state.revision,
                )
        return self._output_capture.image(
            cell_id,
            expected_revision=expected_revision,
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

    @traitlets.observe("_selector")
    def _keep_selector_authoritative(self, change: traitlets.Bunch) -> None:
        if not hasattr(self, "_dom_selector"):
            return
        if change.get("new") != self._dom_selector:
            self.set_trait("_selector", self._dom_selector)

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
            with self._lock:
                if capture_event == "ready":
                    self._browser_views += 1
                else:
                    self._browser_views = max(0, self._browser_views - 1)
                ready = self._browser_views > 0
                self._output_capture.set_browser_ready(ready)
                if ready and not self._lens_closed:
                    register_lens(self, current_runtime_scope())
                else:
                    unregister_lens(self)
            return
        if is_response_envelope(content):
            if isinstance(content, Mapping):
                self._output_capture.accept_response(
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


def _validated_dom_selector(dom_selector: str | None) -> str | None:
    if dom_selector is None:
        return None
    if not isinstance(dom_selector, str):
        raise TypeError("dom_selector must be a string or None.")
    selector = dom_selector.strip()
    if not selector:
        raise ValueError("dom_selector must not be empty.")
    try:
        return DOM_SELECTOR_ADAPTER.validate_python(selector)
    except ValidationError as error:
        raise ValueError(
            "dom_selector must contain nonblank valid Unicode with at most "
            "1,024 UTF-16 code units."
        ) from error


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


def _activity_id(value: object) -> str:
    return _validated_identifier(SELECTION_ID_ADAPTER, value, name="activity")


def _attention_address(
    target: str | SelectionReference,
    *,
    expected_revision: int | None,
) -> tuple[AttentionAddress, int | None]:
    if isinstance(target, str):
        revision = (
            _expected_revision(expected_revision)
            if expected_revision is not None
            else None
        )
        return CellAttentionAddress(kind="cell", cell_id=_cell_id(target)), revision
    if not isinstance(target, Mapping):
        raise TypeError("target must be a cell ID or SelectionReference.")
    if expected_revision is None:
        raise TypeError(
            "expected_revision is required when target is a SelectionReference."
        )
    revision = _expected_revision(expected_revision)
    return (
        SelectionAttentionAddress(
            kind="selection",
            selection_id=_selection_id(target.get("id")),
            revision=revision,
        ),
        revision,
    )


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


def _revision_conflict(expected: int, current: int) -> LensError:
    return LensError(
        "revision_conflict",
        f"Expected Lens revision {expected}, but the current revision is {current}.",
        revision=current,
    )


def _resolution_summary(value: object) -> str | None:
    return _optional_transient_text(value, name="summary")


def _attention_message(value: object) -> str | None:
    return _optional_transient_text(value, name="message")


def _reveal_message(value: object) -> str | None:
    return _optional_transient_text(
        value,
        name="message",
        adapter=OPTIONAL_REVEAL_TEXT_ADAPTER,
    )


def _validated_duration_ms(value: object) -> int:
    try:
        return ATTENTION_DURATION_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, _ = _validation_detail(error)
        if error_type == "int_type":
            raise TypeError("duration_ms must be an integer.") from None
        raise ValueError(
            f"duration_ms must be between 1 and {MAX_ATTENTION_DURATION_MS} milliseconds."
        ) from None


def _attention_label(value: object) -> str | None:
    try:
        return OPTIONAL_ATTENTION_LABEL_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type in {"string_type", "none_required"}:
            raise TypeError("label must be a string or None.") from None
        raise ValueError(f"label {message}.") from None


def _optional_transient_text(
    value: object,
    *,
    name: str,
    adapter: TypeAdapter[str | None] = OPTIONAL_ATTENTION_TEXT_ADAPTER,
) -> str | None:
    try:
        return adapter.validate_python(value)
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
