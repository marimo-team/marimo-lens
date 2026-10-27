"""The ``Lens`` anywidget: public methods and browser transport over a ``LensSession``."""

from __future__ import annotations

import logging
import pathlib
import threading
import uuid
import weakref
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from typing import Any, cast

import anywidget
import traitlets

from .._context.lens_context import LensContext
from .._core.errors import LensError, Rejection, revision_conflict
from .._core.types import ActivityHandle, RevealStep, SelectionReference
from .._marimo.adapter import MarimoRuntimeAdapter
from .._marimo.kernel import current_cell_id, current_runtime_scope
from .._protocol.codec import (
    ProtocolError,
    error_response,
    is_response_envelope,
    parse_capture_browser_event,
    parse_command,
    request_id_from,
)
from .._protocol.messages import (
    AttentionActivityStartEvent,
    AttentionActivityStartPayload,
    AttentionActivityStopEvent,
    AttentionActivityStopPayload,
    AttentionAddress,
    AttentionRevealEvent,
    AttentionTrailStopEvent,
    ResolvedSelection,
    SelectionAttentionAddress,
    SelectionResolvedEvent,
    SelectionResolvedPayload,
    Trail,
    TrailStep,
    TrailStopPayload,
)
from .._schema.model import dump_model
from .._session.session import LensSession
from . import arguments
from .capture import OutputCaptureSlot
from .commands import execute
from .registry import (
    automatic_lenses,
    record_origin,
    register_lens,
    unregister_lens,
)

_LOGGER = logging.getLogger(__name__)

_STATIC = pathlib.Path(__file__).parents[1] / "static"

# Each synced trait and the attribute that holds its Python-owned value. A
# browser write that differs is replaced.
_TRAIT_OWNERS = {
    "_state": "_session",
    "_selector": "_dom_selector",
}


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
    # Browser views of one Lens share this ID, so a document can tell a second
    # view of its owning Lens from another Lens.
    _lens_id = traitlets.Unicode().tag(sync=True)

    def __init__(
        self,
        *,
        dom_selector: str | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._lens_closed = True
        selector = arguments.validated_dom_selector(dom_selector)
        self._lens_closed = False
        self._dom_selector = selector
        # One kernel model may be rendered by several browser consumers.
        self._browser_views = 0
        scope, cell_id = current_runtime_scope(), current_cell_id()
        self._notebook = MarimoRuntimeAdapter()
        self._session = LensSession(
            self._notebook,
            lock=self._lock,
            publish=self._publish_state,
        )
        self._trail_id: str | None = None
        self._trail_release: Callable[[], None] | None = None
        super().__init__(
            _state=self._session.state.payload(),
            _selector=selector,
            _lens_id=uuid.uuid4().hex,
        )
        self._output_capture = OutputCaptureSlot(
            lock=self._lock,
            send=self.send,
            revision=lambda: self._session.state.revision,
            cell_status=self._notebook.cell_status,
        )
        self._bind_comm_close()
        self.on_msg(self._handle_lens_message)
        record_origin(self, scope, cell_id)
        # A Lens created by a notebook cell replaces marimo's automatic Lens.
        # Hosts that never call automatic_lens() leave this path inert.
        automatic = automatic_lenses(scope)
        if (
            automatic
            and cell_id is not None
            and self._notebook.cell_status(cell_id) == "available"
        ):
            for lens in automatic:
                lens.close()

    def context(self) -> LensContext:
        """Return detached selection context from the current marimo runtime.

        Raises:
            LensError: The Lens is closed.
        """

        return self._session.context()

    def reveal(
        self,
        target: str | SelectionReference | Sequence[RevealStep],
        *,
        expected_revision: int | None = None,
        duration_ms: int | None,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Reveal a cell, selection, or 1–16 ordered steps.

        Selection references require their captured expected_revision. Labels
        and messages belong on each step when passing a sequence. None holds
        until dismissal; a finite duration limits the entire presentation.
        """
        duration = (
            arguments.validated_duration_ms(duration_ms)
            if duration_ms is not None
            else None
        )
        normalized = arguments.reveal_steps(
            target, expected_revision=expected_revision, label=label, message=message
        )
        with self._lock:
            self._require_open()
            trail_steps = []
            cell_ids = []
            for (address, revision), step_label, step_message in normalized:
                cell_ids.extend(self._attention_cells(address, revision))
                trail_steps.append(
                    TrailStep(address=address, label=step_label, message=step_message)
                )
            trail = Trail(id=uuid.uuid4().hex, steps=trail_steps, duration_ms=duration)
            owner = weakref.ref(self)

            def invalidate() -> None:
                lens = owner()
                if lens is not None:
                    with lens._lock:
                        if lens._trail_id == trail.id:
                            lens._clear_trail()
                            with suppress(Exception):
                                lens.send(
                                    dump_model(
                                        AttentionTrailStopEvent(
                                            payload=TrailStopPayload(trail_id=trail.id)
                                        )
                                    )
                                )

            release = (
                self._notebook.observe_cells(cell_ids, invalidate) if cell_ids else None
            )
            self._clear_trail()
            self._trail_id, self._trail_release = trail.id, release
            with suppress(Exception):
                self.send(dump_model(AttentionRevealEvent(payload=trail)))

    def _clear_trail(self) -> None:
        if self._trail_release is not None:
            self._trail_release()
        self._trail_id = self._trail_release = None

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
        activity_message = arguments.optional_text(message, name="message")
        attention_label = arguments.attention_label(label)
        activity_duration = (
            arguments.validated_duration_ms(duration_ms)
            if duration_ms is not None
            else None
        )
        self._send_attention(
            target,
            expected_revision=expected_revision,
            event=lambda address: AttentionActivityStartEvent(
                payload=AttentionActivityStartPayload(
                    activity_id=activity_id,
                    address=address,
                    duration_ms=activity_duration,
                    label=attention_label,
                    message=activity_message,
                )
            ),
        )
        return ActivityHandle(activity_id)

    def stop_activity(self, activity: ActivityHandle) -> None:
        """Stop activity when ``activity`` still owns the presentation.

        The handle may cross a JSON round trip. A non-current handle has no
        effect.
        """

        activity_id = arguments.activity_id(activity)
        with self._lock:
            self._require_open()
            event = AttentionActivityStopEvent(
                payload=AttentionActivityStopPayload(activity_id=activity_id)
            )
            with suppress(Exception):
                self.send(dump_model(event))

    def _send_attention(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None,
        event: Callable[[AttentionAddress], AttentionActivityStartEvent],
    ) -> None:
        address, expected_revision = arguments.attention_address(
            target,
            expected_revision=expected_revision,
        )
        with self._lock:
            self._require_open()
            self._attention_cells(address, expected_revision)
            self._clear_trail()
            with suppress(Exception):
                self.send(dump_model(event(address)))

    def _attention_cells(
        self,
        address: AttentionAddress,
        expected_revision: int | None,
    ) -> tuple[str, ...]:
        if isinstance(address, SelectionAttentionAddress):
            return self._session.attention_cells(
                selection_id=address.selection_id, expected_revision=expected_revision
            )
        return self._session.attention_cells(
            cell_id=address.cell_id, expected_revision=expected_revision
        )

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move completed selections into History and return the new revision.

        Include a summary of what changed and what you verified, up to 240
        UTF-16 code units. It appears beside the original request in each
        History entry. All selections in a batch share the same summary.
        """

        normalized_ids = arguments.selection_ids(selection_ids)
        expected_revision = arguments.checked_revision(expected_revision)
        summary = arguments.optional_text(summary, name="summary")

        with self._lock:
            resolution = self._session.resolve(
                normalized_ids,
                expected_revision=expected_revision,
                summary=summary,
            )
            if resolution.selections:
                event = SelectionResolvedEvent(
                    revision=resolution.revision,
                    payload=SelectionResolvedPayload(
                        selections=tuple(
                            ResolvedSelection(
                                selection_id=selection.id,
                                label=selection.label,
                                resolution_revision=resolution.revision,
                            )
                            for selection in resolution.selections
                        ),
                        summary=resolution.summary,
                    ),
                )
                # Serialize presentation events with their mutations so
                # concurrent resolutions reach the browser in revision order.
                with suppress(Exception):
                    self.send(dump_model(event))
            return resolution.revision

    def close(self) -> None:
        """Close the widget and release its in-memory PNG captures."""

        with self._lock:
            if self._lens_closed:
                return
            self._lens_closed = True
            self._output_capture.close()
            self._session.close()
            self._clear_trail()
        unregister_lens(self)
        super().close()

    def _cell_image(
        self,
        cell_id: str,
        *,
        expected_revision: int,
    ) -> bytes | None:
        """Return current cell PNG bytes across consecutive kernel calls."""

        cell_id = arguments.cell_id(cell_id)
        expected_revision = arguments.checked_revision(expected_revision)
        with self._lock:
            self._require_open()
            revision = self._session.state.revision
            if revision != expected_revision:
                raise revision_conflict(expected_revision, revision)
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
        # The wrapper forwards the host comm's positional and keyword arguments unchanged.
        original_close = cast(Callable[..., None], comm_type.close)
        lens_ref = weakref.ref(self)
        comm_ref = weakref.ref(comm)
        pending_close: tuple[tuple[object, ...], dict[str, object]] | None = None

        def close_comm(*args: object, **kwargs: object) -> None:
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

    @traitlets.observe(*_TRAIT_OWNERS)
    def _keep_traits_authoritative(self, change: traitlets.Bunch) -> None:
        name = change["name"]
        owner = _TRAIT_OWNERS[name]
        # Traits change while __init__ runs, before their owner exists.
        if not hasattr(self, owner):
            return
        if name != "_state":
            if change.get("new") != getattr(self, owner):
                self.set_trait(name, getattr(self, owner))
            return
        with self._lock:
            canonical = self._session.state.payload()
            if change.get("new") != canonical:
                self.set_trait(name, canonical)

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
                    revision=self._session.state.revision,
                    code=error.code,
                    message=str(error),
                )
            )
            return
        if command is None:
            return

        response_buffers: tuple[bytes, ...] = ()
        try:
            with self._lock:
                self._require_protocol_open()
                response, response_buffers = execute(self._session, command, buffers)
        except (Rejection, LensError) as error:
            response = error_response(
                request_id=command.request_id,
                revision=self._session.state.revision,
                code=error.code,
                message=str(error),
            )
        except Exception:
            _LOGGER.exception("Lens command failed")
            response = error_response(
                request_id=command.request_id,
                revision=self._session.state.revision,
                code="internal_error",
                message="Lens could not apply this command.",
            )
        self.send(response, buffers=list(response_buffers))

    def _publish_state(self, payload: dict[str, Any]) -> None:
        self.set_trait("_state", payload)

    def _require_open(self) -> None:
        if self._lens_closed:
            raise LensError(
                "lens_closed",
                "Lens is closed.",
                revision=self._session.state.revision,
            )

    def _require_protocol_open(self) -> None:
        if self._lens_closed:
            raise ProtocolError("lens_closed", "Lens is closed.")
