"""The ``Lens`` anywidget: public methods and browser transport over a ``LensSession``."""

from __future__ import annotations

import logging
import pathlib
import threading
import uuid
import weakref
from collections.abc import Callable, Mapping, Sequence
from typing import Any, cast

import anywidget
import traitlets

from .._context.lens_context import LensContext
from .._core.errors import LensError, Rejection
from .._core.record import Record, RecordOptions
from .._core.types import (
    ActivityHandle,
    CellReference,
    Diagnostic,
    RevealStep,
    SelectionReference,
)
from .._marimo.adapter import MarimoRuntimeAdapter
from .._marimo.kernel import current_cell_id, current_runtime_scope
from .._marimo.lifecycle import bind_creator_lifecycle, construction_slot
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
from .._record.history import EMPTY_HISTORY
from .._record.lines import OpenRequest
from .._record.requests import chats_trait
from .._schema.model import dump_model
from .._session.runtime import lens_runtime
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
    "_history": "_history_state",
    "_chats": "_chats_state",
    "_selector": "_dom_selector",
    "_lens_id": "_owner",
}


class Lens(anywidget.AnyWidget):
    """Collect grounded selections from notebook outputs and configured DOM roots.

    .. code-block:: python

        lens = Lens()
        lens = Lens(record=True)
        lens = Lens(record={"history": False})
        lens = Lens(record=True, dom_selector="#report")

    Every Lens holds the analyst's open selections with their notes and
    annotated PNGs, opens selection and chat requests, and resolves them
    with a receipt in the browser. ``record`` adds a record of resolved
    requests, described in ``Record``.
    """

    _marimo_lens_widget = True
    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    _state = traitlets.Dict(
        default_value={
            "revision": 0,
            "nextLabel": "S1",
            "currentSelectionId": None,
            "selections": [],
        }
    ).tag(sync=True)
    # None for the Lens's whole life when it shows no History.
    _history = traitlets.Dict(default_value=None, allow_none=True).tag(sync=True)
    # The runtime's open chat requests, which every Lens of the runtime shows.
    _chats = traitlets.List().tag(sync=True)
    _selector = traitlets.Unicode(default_value=None, allow_none=True).tag(sync=True)
    # Browser views of one Lens share this ID, so a document can tell a second
    # view of its owning Lens from another Lens.
    _lens_id = traitlets.Unicode().tag(sync=True)

    def __init__(
        self,
        *,
        record: Record | RecordOptions | bool | None = None,
        dom_selector: str | None = None,
    ) -> None:
        """Create a Lens for the active marimo notebook.

        Arguments:
            record: The record of resolved requests this Lens keeps. ``True``
                keeps a full ``Record()``. A dict such as
                ``{"keep": "session", "images": False}`` sets the
                ``RecordOptions`` it names and leaves the rest at their
                defaults. Lens keeps a ``Record`` as given. ``None``, the
                default, and ``False`` keep no record. The Lens then opens no
                journal and writes no record file.
            dom_selector: A CSS selector that adds configured DOM targets to
                the notebook targets, or None. It is stripped and holds at
                most 1,024 UTF-16 code units.

        Raises:
            TypeError: ``record`` is not a bool, None, a dict, or a
                ``Record``, a dict names an unknown option or holds a value
                of the wrong type, or ``dom_selector`` is not a string.
            ValueError: ``record`` names an unknown ``keep``, or
                ``dom_selector`` is empty or too long.
        """

        self._lock = threading.RLock()
        self._lens_closed = True
        kept = arguments.validated_record(record)
        selector = arguments.validated_dom_selector(dom_selector)
        self._lens_closed = False
        self._dom_selector = selector
        # One kernel model may be rendered by several browser consumers.
        self._browser_views = 0
        scope, cell_id = current_runtime_scope(), current_cell_id()
        self._notebook = MarimoRuntimeAdapter()
        lens_id = self._owner = uuid.uuid4().hex
        runtime = lens_runtime(scope)
        slot = construction_slot()
        self._session = LensSession(
            runtime,
            self._notebook,
            record=None
            if kept is None
            else runtime.record(
                kept,
                storage=self._notebook.storage(kept.keep),
                journal=self._notebook.journal,
            ),
            owner=lens_id,
            publish=self._publish_state,
            publish_history=self._set_history,
        )
        self._history_state: dict[str, Any] | None = (
            dict(EMPTY_HISTORY) if kept is not None and kept.history else None
        )
        self._runtime = runtime
        self._chats_state: list[dict[str, Any]] = []
        self._unwatch_chats: Callable[[], None] = lambda: None
        self._trail_id: str | None = None
        self._trail_release: Callable[[], None] | None = None
        super().__init__(
            _state=self._session.state.payload(),
            _history=self._history_state,
            _selector=selector,
            _lens_id=lens_id,
        )
        self._output_capture = OutputCaptureSlot(
            lock=self._lock,
            send=self.send,
            revision=lambda: self._session.state.revision,
            cell_status=self._notebook.cell_status,
        )
        self._bind_comm_close()
        self._follow_chats()
        if slot is not None:
            owner_ref = weakref.ref(self)

            def dispose(rerun: bool) -> None:
                owner = owner_ref()
                if owner is not None:
                    owner._close(rerun=rerun)

            if bind_creator_lifecycle(self.comm, slot, lens_id, runtime, dispose):
                with self._lock:
                    self._session.attach(slot, selector=selector, generation=lens_id)
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

    @property
    def record(self) -> Record | None:
        """Return the ``Record`` this Lens keeps, or None when it keeps none.

        ``Lens(record=True)`` returns ``Record()``, and a dict returns the
        ``Record`` it describes.
        """

        return self._session.record

    def context(self) -> LensContext:
        """Return a detached snapshot of the current Lens context.

        The snapshot carries its revision, bounded notebook text, selection
        references, and annotated selection PNG bytes. Read another snapshot
        after the notebook or Lens state changes.

        Raises:
            LensError: The Lens is closed.
        """

        with self._lock:
            return self._session.context()

    def check(self) -> list[Diagnostic]:
        """Check open selections, and the record when this Lens keeps one.

        Returns one diagnostic per finding, warnings first. ``LV`` rules flag a
        selected output from a stale or failed cell, or from a cell that
        changed after the selection opened. ``LT`` rules flag published
        sources that name a missing cell or an undefined value. ``LR`` rules
        run when the Lens keeps a record and flag record lines Lens cannot
        read, changes whose code the record left out, and cells the record
        names that are gone. Each diagnostic names its rule code, severity,
        message, cell, and request. An empty list means every check passed.

        Call it after editing cells for a request, inside the same code-mode
        call, so marimo's notebook document is in reach.

        Raises:
            LensError: The Lens is closed.
        """

        with self._lock:
            return self._session.check()

    def reveal(
        self,
        target: str | SelectionReference | Sequence[RevealStep],
        *,
        expected_revision: int | None = None,
        duration_ms: int | None,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Reveal a cell, selection, or 1–16 ordered steps for the supplied hold.

        Pass a LensContext revision with a SelectionReference. Labels and
        messages belong on each step when passing a sequence. A None duration
        holds until dismissal, and a finite one limits the entire
        presentation. Reveal replaces current activity. Call reveal() before
        resolve() with the same captured revision in one kernel call. The
        browser presents the resolution receipt after the reveal ends.

        Raises:
            LensError: The Lens is closed, a selection revision changed, a
                selection is missing, or the runtime cannot resolve a cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
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
                            try:
                                lens.send(
                                    dump_model(
                                        AttentionTrailStopEvent(
                                            payload=TrailStopPayload(trail_id=trail.id)
                                        )
                                    )
                                )
                            except Exception:
                                _LOGGER.exception("Lens could not stop its trail")

            release = (
                self._notebook.observe_cells(cell_ids, invalidate) if cell_ids else None
            )
            self._clear_trail()
            self._trail_id, self._trail_release = trail.id, release
            try:
                self.send(dump_model(AttentionRevealEvent(payload=trail)))
            except Exception:
                _LOGGER.exception("Lens could not send its trail")
                self._clear_trail()

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
        """Show one cell or selection as the current work target.

        Pass a LensContext revision with a SelectionReference. Leave
        duration_ms unset to keep activity visible until stop_activity() or
        another attention event replaces it. A supplied duration clears the
        activity after that hold. The returned JSON-safe handle stops this
        activity when it still owns the browser presentation.

        Raises:
            LensError: The Lens is closed, a selection revision changed, a
                selection is missing, or the runtime cannot resolve a cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
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

        Raises:
            LensError: The Lens is closed.
            TypeError: The argument is not a string activity handle.
            ValueError: The handle is empty or exceeds its size limit.
        """

        activity_id = arguments.activity_id(activity)
        with self._lock:
            self._require_open()
            event = AttentionActivityStopEvent(
                payload=AttentionActivityStopPayload(activity_id=activity_id)
            )
            try:
                self.send(dump_model(event))
            except Exception:
                _LOGGER.exception("Lens could not stop its activity")

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
            try:
                self.send(dump_model(event(address)))
            except Exception:
                _LOGGER.exception("Lens could not send its attention")

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

    def open_request(
        self,
        note: str,
        cells: Sequence[str | CellReference] | None = None,
    ) -> str:
        """Open a chat request for an analyst's chat message and return its ID.

        Open one when a chat message asks to change the notebook or explain a
        result in it, unless an open selection already carries that request.
        Quote the message as ``note`` and name the cells it is about in
        ``cells``, by ID or by the cell references Lens returns. Lens takes a
        baseline of the notebook now, so a record attributes later cell edits
        to this request until resolve(). The record of the Lens that resolves
        the request keeps it. Opening a request leaves the selection revision
        unchanged. Keep the ID to resolve the request in a later call.

        Raises:
            LensError: The Lens is closed, 16 chat requests are already open,
                the runtime is unavailable for named cells, or a named cell
                is not in the notebook.
            TypeError: An argument has the wrong type.
            ValueError: The note is blank or too long, or cells has
                duplicates or more than 16 cells.
        """

        request_note = arguments.request_note(note)
        cell_ids = arguments.request_cells(cells)
        with self._lock:
            return self._session.open_request(request_note, cell_ids)

    def resolve(
        self,
        request_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Resolve selection and chat requests and return the selection revision.

        Include a user-facing summary of what changed and what you verified,
        up to 240 UTF-16 code units. The browser shows it in the resolution
        receipt of a batch that holds a selection, and a Lens that keeps a
        record stores it beside the original request. Report a chat-only
        resolution in the chat, since it shows no receipt. All requests in a
        batch share the summary, so batch requests that share an outcome and
        resolve separately with distinct summaries when outcomes differ. If
        verification required no change, summarize the finding and why it
        answers the request.

        Resolving selections closes them and advances the revision. Pass the
        returned revision to the next guarded Lens mutation.
        ``expected_revision`` guards those selections. Resolving only chat
        requests leaves the revision unchanged and accepts any revision. A
        Lens that keeps a record records the resolution before it closes any
        request, so ``record_full`` leaves every request open.

        Raises:
            LensError: The Lens is closed, the revision changed while the
                batch holds a selection, a request is not open, or the record
                cannot take the resolution.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        normalized_ids = arguments.request_ids(request_ids)
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
                                target=selection.target,
                            )
                            for selection in resolution.selections
                        ),
                        resolved_at=resolution.resolved_at,
                        summary=resolution.summary,
                    ),
                )
                # Serialize presentation events with their mutations so
                # concurrent resolutions reach the browser in revision order.
                try:
                    self.send(dump_model(event))
                except Exception:
                    _LOGGER.exception("Lens could not announce its resolution")
            return resolution.revision

    def _set_history(self, history: dict[str, Any]) -> None:
        self._history_state = history
        self.set_trait("_history", history)

    def _follow_chats(self) -> None:
        """Publish the runtime's open chat requests now and whenever they change.

        The runtime outlives each Lens, so it holds this Lens weakly and drops
        the watcher when the Lens is collected without ``close()``.
        """

        lens_ref = weakref.ref(self)

        def publish(chats: tuple[OpenRequest, ...]) -> None:
            lens = lens_ref()
            if lens is not None:
                lens._set_chats(chats)

        requests = self._runtime.requests
        with self._runtime.lock:
            unwatch = requests.watch_chats(publish)
            self._unwatch_chats = unwatch
            self._set_chats(requests.chats())
        weakref.finalize(self, unwatch)

    def _set_chats(self, chats: tuple[OpenRequest, ...]) -> None:
        try:
            self._chats_state = chats_trait(chats)
            self.set_trait("_chats", self._chats_state)
        except Exception:
            _LOGGER.exception("Lens could not publish its open chat requests")

    def close(self) -> None:
        """Close the widget and release its in-memory PNG captures."""

        self._close(rerun=False)

    def _close(self, *, rerun: bool) -> None:
        with self._lock:
            if self._lens_closed:
                return
            self._lens_closed = True
            self._browser_views = 0
            self._output_capture.close()
            with self._runtime.lock:
                self._unwatch_chats()
            if rerun:
                self._session.detach()
            else:
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

        return self._output_capture.image(
            arguments.cell_id(cell_id),
            expected_revision=arguments.checked_revision(expected_revision),
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
            # Chat changes publish here while the runtime lock is held, so
            # taking the Lens lock could deadlock against another Lens.
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
                    if capture_event == "ready" and self._browser_views == 1:
                        self._session.prepare()
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
            request_id = request_id_from(content)
            if request_id is None:
                _LOGGER.warning(
                    "Lens ignored a command without a request ID: %s", error
                )
                return
            self.send(
                error_response(
                    request_id=request_id,
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
