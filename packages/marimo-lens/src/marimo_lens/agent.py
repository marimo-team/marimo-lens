"""Connect agents to Lens so humans direct analysis and judge evidence agents return.

Treat a Lens selection as both a visual request and a computational address.
The marked output and note capture what drew the human's attention. Stable
output-cell identity names the producing cell. Lens follows the current marimo
dependency graph upstream from that cell and supplies a bounded closure of the
code that produced the result. Start with this graph-grounded context before
inspecting live values or changing the notebook.

Use Lens to expose your work, return focus to verified results, and preserve
addressed requests in History so the human can review, repair, and continue the
analysis across turns.

Use this module inside a live marimo code-mode kernel call:

    import marimo_lens.agent as lens_agent

    mounted = lens_agent.connect()
    snapshot = mounted.context()

After connect() raises LensError(code="lens_unavailable"), queue a Lens cell
in a fresh kernel call:

    import marimo._code_mode as cm
    import marimo_lens.agent as lens_agent

    async with cm.get_context() as ctx:
        lens_agent.add_lens_cell(ctx)

End that kernel call, then connect again after the browser renders Lens.

Keep mounted.identity and snapshot.revision together when work spans kernel
calls. Reconnect with connect(identity=identity).

Use code mode to inspect, edit, and run notebook cells. The Lens snapshot
supplies bounded text, selection references, and annotated selection PNG bytes.
MountedLens.cell_image() transfers a fresh unannotated cell PNG across kernel
calls.

Start activity when the work cell is known. After a fresh runtime check, stop
activity and reveal the verified result. Wait for the reveal hold before
resolving the addressed selections.
"""

from __future__ import annotations

import secrets
import threading
import weakref
from collections.abc import Sequence

from .context import LensContext
from .errors import LensError
from .widget import Lens, _mounted_lenses

_IDENTITIES: weakref.WeakKeyDictionary[Lens, str] = weakref.WeakKeyDictionary()
_IDENTITIES_LOCK = threading.RLock()
# Private bindings introduce no public names into marimo's dataflow graph.
_LENS_CELL_CODE = """\
import marimo as _mo
from marimo_lens import Lens as _Lens

_lens = _Lens()
_mo.output.append(_lens)
"""


class MountedLens:
    """A live Lens handle returned by connect().

    Its identity and mounted Lens remain fixed for the handle's lifetime.
    Keep identity to reconnect to the same mounted Lens in a later kernel call.
    """

    __slots__ = ("__identity", "__lens")

    def __init__(self, identity: str, lens: Lens) -> None:
        """Initialize a handle for a Lens resolved by connect()."""

        self.__identity = identity
        self.__lens = lens

    @property
    def identity(self) -> str:
        """Return the opaque identity used to reconnect this mounted Lens."""

        return self.__identity

    @property
    def _lens(self) -> Lens:
        return self.__lens

    def __repr__(self) -> str:
        """Return a diagnostic representation containing the opaque identity."""

        return f"MountedLens(identity={self.identity!r})"

    def context(self) -> LensContext:
        """Return a detached snapshot of the current Lens context.

        The snapshot carries its revision, bounded notebook text, selection
        references, and annotated selection PNG bytes. Read another snapshot
        after the notebook or Lens state changes.

        Raises:
            LensError: The mounted Lens is closed.
        """

        return self._lens.context()

    def cell_image(self, cell_id: str, *, expected_revision: int) -> bytes | None:
        """Return a fresh unannotated cell PNG across kernel calls.

        The first call starts browser capture and returns None. End the current
        kernel call so the browser can respond, then repeat the call with the
        same cell ID and revision. A completed call returns and consumes the
        PNG bytes.

        Raises:
            LensError: The revision changed, another capture is pending, or
                the Lens, runtime, cell, browser, or capture is unavailable.
            TypeError: The cell ID or revision has the wrong type.
            ValueError: The cell ID or revision is outside its accepted range.
        """

        return self._lens._cell_image(
            cell_id,
            expected_revision=expected_revision,
        )

    def start_activity(
        self,
        cell_id: str,
        *,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Show one cell as the current work target.

        Leave duration_ms unset to keep activity visible until stop_activity()
        or another attention event replaces it. A supplied duration clears the
        activity after that hold.

        Raises:
            LensError: The Lens is closed or the runtime cannot resolve the
                supplied cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        self._lens.start_activity(
            cell_id,
            duration_ms=duration_ms,
            label=label,
            message=message,
        )

    def stop_activity(self, cell_id: str) -> None:
        """Stop activity when it is attached to the supplied cell.

        Raises:
            LensError: The mounted Lens is closed.
            TypeError: The cell ID has the wrong type.
            ValueError: The cell ID is outside its accepted range.
        """

        self._lens.stop_activity(cell_id)

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move verified selections to History and return the new revision.

        Pass the returned revision to the next guarded Lens mutation. The state
        transition commits before Lens sends its browser receipt.

        Raises:
            LensError: The Lens is closed, the revision changed, or a selection
                cannot be resolved.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        return self._lens.resolve(
            selection_ids,
            expected_revision=expected_revision,
            summary=summary,
        )

    def reveal(
        self,
        cell_id: str,
        *,
        duration_ms: int,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Bring one exact cell into view for the supplied hold.

        Wait for duration_ms before resolving addressed selections when the
        resolution receipt should follow the revealed result.

        Raises:
            LensError: The Lens is closed or the runtime cannot resolve the
                supplied cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        self._lens.reveal(
            cell_id,
            label=label,
            message=message,
            duration_ms=duration_ms,
        )


def add_lens_cell(ctx: object) -> str:
    """Queue a collapsed notebook cell that mounts a Lens.

    The code-mode context creates and runs the cell when its async context
    manager exits. Call connect() in a later kernel call after the browser has
    rendered the cell.

    Returns:
        The queued cell ID.

    Raises:
        TypeError: The context lacks the code-mode cell mutation methods.
    """

    create_cell = getattr(ctx, "create_cell", None)
    run_cell = getattr(ctx, "run_cell", None)
    if not callable(create_cell) or not callable(run_cell):
        raise TypeError("context must be a live marimo code-mode context")

    cell_id = create_cell(_LENS_CELL_CODE, hide_code=True)
    run_cell(cell_id)
    return str(cell_id)


def connect(*, identity: str | None = None) -> MountedLens:
    """Return the mounted Lens selected from the active marimo runtime.

    Pass an earlier handle's identity to reconnect to that Lens in a later
    kernel call.

    Raises:
        LensError: No mounted Lens matches, or several are mounted without an
            identity selecting one.
        TypeError: Identity has the wrong type.
        ValueError: Identity is empty.
    """

    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    mounted = tuple(
        MountedLens(
            identity=_identity(lens),
            lens=lens,
        )
        for lens in _mounted_lenses()
    )
    if identity is not None:
        for lens in mounted:
            if lens.identity == identity:
                return lens
        raise LensError(
            "lens_unavailable",
            (
                "The requested mounted Lens is unavailable. "
                "Connect again without an identity."
            ),
        )
    if len(mounted) == 1:
        return mounted[0]
    if not mounted:
        raise LensError(
            "lens_unavailable",
            "No mounted Lens is available in the active notebook.",
        )
    raise LensError(
        "lens_ambiguous",
        (
            "The active notebook has multiple mounted Lens widgets. "
            "Leave one mounted before connecting."
        ),
    )


def _identity(lens: Lens) -> str:
    with _IDENTITIES_LOCK:
        identity = _IDENTITIES.get(lens)
        if identity is None:
            identity = secrets.token_urlsafe(24)
            _IDENTITIES[lens] = identity
        return identity


__all__ = [
    "MountedLens",
    "add_lens_cell",
    "connect",
]
