"""Agent adapter for mounted marimo Lens widgets.

Example:
    import marimo_lens.agent as lens_agent
    import marimo._code_mode as cm

    async with cm.get_context() as ctx:
        mounted = lens_agent.connect(ctx)
        snapshot = mounted.context()

``connect(ctx, identity=...)`` reconnects to the exact Lens from an earlier
kernel call.

Use :meth:`MountedLens.context` for standalone text, selection context, and
captured selection PNG bytes. :meth:`MountedLens.cell_image` returns fresh
unannotated cell PNG bytes after capture completes in a later kernel call.

Call :meth:`MountedLens.start_activity` as soon as the work cell is known.
After the mutation and a fresh runtime check, call
:meth:`MountedLens.stop_activity`, present the result with
:meth:`MountedLens.reveal`, then call :meth:`MountedLens.resolve` after the
reveal hold for addressed selections.
"""

from __future__ import annotations

import secrets
import threading
import weakref
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from .context import LensContext
from .errors import LensError
from .widget import Lens

_IDENTITIES: weakref.WeakKeyDictionary[Lens, str] = weakref.WeakKeyDictionary()
_IDENTITIES_LOCK = threading.RLock()


@dataclass(frozen=True, slots=True)
class MountedLens:
    """One mounted Lens connected through a live marimo code-mode context."""

    identity: str
    _lens: Lens = field(repr=False)

    def context(self) -> LensContext:
        """Return the current detached Lens context."""

        return self._lens.context()

    def cell_image(self, cell_id: str, *, expected_revision: int) -> bytes | None:
        """Return fresh cell PNG bytes when capture has completed."""

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
        """Show one work cell until stopped or the optional duration ends."""

        self._lens.start_activity(
            cell_id,
            duration_ms=duration_ms,
            label=label,
            message=message,
        )

    def stop_activity(self, cell_id: str) -> None:
        """Stop activity attached to the supplied work cell."""

        self._lens.stop_activity(cell_id)

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move verified selections to History and return the new revision."""

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
        """Bring one cell into view for the supplied hold."""

        self._lens.reveal(
            cell_id,
            label=label,
            message=message,
            duration_ms=duration_ms,
        )


def connect(
    context: object,
    *,
    identity: str | None = None,
) -> MountedLens:
    """Return one mounted Lens from a live marimo code-mode context.

    Pass an earlier handle's ``identity`` to reconnect to the same Lens in a
    later kernel call.
    """

    namespace = getattr(context, "globals", None)
    if not isinstance(namespace, Mapping):
        raise TypeError("context must expose a globals mapping")
    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    candidates: dict[int, Lens] = {}
    for value in namespace.values():
        lens = _as_lens(value)
        if lens is None:
            continue
        candidates.setdefault(id(lens), lens)

    mounted = tuple(
        MountedLens(
            identity=_identity(lens),
            _lens=lens,
        )
        for lens in candidates.values()
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


def _as_lens(value: object) -> Lens | None:
    if isinstance(value, Lens):
        lens = value
    elif type(value).__module__.startswith("marimo."):
        lens = getattr(value, "widget", None)
        if not isinstance(lens, Lens):
            return None
    else:
        return None
    if getattr(lens, "_lens_closed", False) or getattr(lens, "comm", None) is None:
        return None
    return lens


def _identity(lens: Lens) -> str:
    with _IDENTITIES_LOCK:
        identity = _IDENTITIES.get(lens)
        if identity is None:
            identity = secrets.token_urlsafe(24)
            _IDENTITIES[lens] = identity
        return identity


__all__ = [
    "MountedLens",
    "connect",
]
