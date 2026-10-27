"""Connect code-mode agents to Lens."""

from __future__ import annotations

import ast
import dataclasses
import secrets
import threading
import weakref
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol, TypeVar, cast

import agent_plugins

from ._context.lens_context import LensContext
from ._core.errors import LensError
from ._core.record import Record, RecordOptions
from ._core.types import (
    ActivityHandle,
    CellReference,
    Diagnostic,
    RevealStep,
    SelectionReference,
)
from ._marimo.kernel import current_runtime_scope
from ._widget.arguments import validated_record
from ._widget.lens import Lens
from ._widget.registry import mounted_lenses, open_lenses_from_cell

_F = TypeVar("_F", bound=Callable[..., object])

_DISTRIBUTION_NAME = "marimo-lens"
_SKILL_NAME = "marimo-lens"


def plugin() -> agent_plugins.Plugin:
    """Return the Agent Plugin installed with this Lens version."""
    return agent_plugins.locate(_DISTRIBUTION_NAME)


def skill() -> agent_plugins.Skill:
    """Return Lens's packaged Agent Skill."""
    return plugin().skill(_SKILL_NAME)


class _CodeModeCell(Protocol):
    id: object
    status: object
    code: str


_IDENTITIES: weakref.WeakKeyDictionary[Lens, str] = weakref.WeakKeyDictionary()
_IDENTITIES_LOCK = threading.RLock()
_LENS_CELL_MARKER = "# marimo-lens: agent-managed Lens cell"
# Private bindings introduce no public names into marimo's dataflow graph.
_LENS_CELL_CODE = f"""\
{_LENS_CELL_MARKER}
import marimo as _mo
from marimo_lens import Lens as _Lens

_lens = _Lens({{arguments}})
_mo.output.append(_lens)
"""


def _lens_arguments(record: Record | None) -> str:
    """Return the shortest ``Lens`` arguments that keep ``record``."""

    if record is None:
        return ""
    changed = {
        field.name: getattr(record, field.name)
        for field in dataclasses.fields(record)
        if getattr(record, field.name) != field.default
    }
    if not changed:
        return "record=True"
    options = ", ".join(
        f'"{name}": ' + (f'"{value}"' if isinstance(value, str) else repr(value))
        for name, value in changed.items()
    )
    return f"record={{{options}}}"


class _Unreadable:
    pass


_UNREADABLE = _Unreadable()


def _cell_record(code: str) -> Record | _Unreadable | None:
    """Return the record the ``_Lens(...)`` call in ``code`` keeps.

    Returns ``_UNREADABLE`` when the call or its ``record`` is not a literal
    this module wrote, such as a cell the analyst rewrote.
    """

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return _UNREADABLE
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_Lens"
        ):
            value = next(
                (keyword.value for keyword in node.keywords if keyword.arg == "record"),
                None,
            )
            if value is None:
                return None
            try:
                return validated_record(ast.literal_eval(value))
            except (TypeError, ValueError):
                return _UNREADABLE
    return _UNREADABLE


def _documented_by(method: Callable[..., object]) -> Callable[[_F], _F]:
    def document(forward: _F) -> _F:
        forward.__doc__ = method.__doc__
        return forward

    return document


class MountedLens:
    """A live Lens handle returned by connect().

    Its identity and Lens remain fixed for the handle's lifetime. Keep identity
    to reconnect to the same Lens in a later kernel call. Each method delegates
    to the ``Lens`` method of the same name.
    """

    __slots__ = ("__identity", "__lens")

    def __init__(self, identity: str, lens: Lens) -> None:
        """Initialize a handle for a Lens resolved by connect()."""

        self.__identity = identity
        self.__lens = lens

    @property
    def identity(self) -> str:
        """Return the opaque identity used to reconnect this Lens."""

        return self.__identity

    @property
    def _lens(self) -> Lens:
        return self.__lens

    @property
    def record(self) -> Record | None:
        """Return the ``Record`` the Lens keeps, or None when it keeps none.

        None means ``context().history()`` raises ``record_off``, ``check()``
        returns no ``LR`` diagnostics, and a resolved request ends with its
        browser receipt. ``record.history`` False means the analyst has no
        History tab. ``record.images`` False means recorded requests carry no
        image. ``context().references["notebook"]["record"]["status"]`` says
        where the record lives now.
        """

        return self._lens.record

    def __repr__(self) -> str:
        """Return a diagnostic representation containing the opaque identity."""

        return f"MountedLens(identity={self.identity!r})"

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

    @_documented_by(Lens.context)
    def context(self) -> LensContext:
        return self._lens.context()

    @_documented_by(Lens.start_activity)
    def start_activity(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None = None,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> ActivityHandle:
        return self._lens.start_activity(
            target,
            expected_revision=expected_revision,
            duration_ms=duration_ms,
            label=label,
            message=message,
        )

    @_documented_by(Lens.stop_activity)
    def stop_activity(self, activity: ActivityHandle) -> None:
        self._lens.stop_activity(activity)

    @_documented_by(Lens.open_request)
    def open_request(
        self, note: str, cells: Sequence[str | CellReference] | None = None
    ) -> str:
        return self._lens.open_request(note, cells)

    @_documented_by(Lens.check)
    def check(self) -> list[Diagnostic]:
        return self._lens.check()

    @_documented_by(Lens.resolve)
    def resolve(
        self,
        request_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        return self._lens.resolve(
            request_ids, expected_revision=expected_revision, summary=summary
        )

    @_documented_by(Lens.reveal)
    def reveal(
        self,
        target: str | SelectionReference | Sequence[RevealStep],
        *,
        expected_revision: int | None = None,
        duration_ms: int | None,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        self._lens.reveal(
            target,
            expected_revision=expected_revision,
            duration_ms=duration_ms,
            label=label,
            message=message,
        )


def add_lens_cell(
    ctx: object, *, record: Record | RecordOptions | bool | None = None
) -> str:
    """Queue a collapsed notebook cell that mounts a Lens keeping ``record``.

    ``record`` takes the forms ``Lens(record=...)`` takes. The cell spells it
    the shortest way: ``_Lens()``, ``_Lens(record=True)``, or a dict of the
    options that differ from their defaults. Pass a record only when the
    analyst asks for one, since ``keep="notebook"`` writes files beside the
    notebook.

    Return the existing agent-created Lens cell ID when the notebook already
    contains one, and leave that cell's code unchanged. That cell is queued
    to run again unless it still holds an open Lens or is queued, running, or
    disabled. A notebook reopened in a new kernel, a failed first run, or a
    closed Lens then mounts a new Lens. A ``record`` that differs from the
    one the cell keeps raises ``lens_cell_exists``. Edit that cell to change
    its record. The code-mode context creates and runs cells when its async
    context manager exits.

    Call connect() in a later kernel call after the browser has rendered the
    cell.

    Returns:
        The existing or queued cell ID.

    Raises:
        TypeError: The context lacks the required code-mode cell APIs, or
            ``record`` is not a form ``Lens(record=...)`` accepts.
        ValueError: ``record`` names an unknown ``keep``.
        LensError: The notebook contains several agent-created Lens cells, or
            its Lens cell keeps a record other than ``record``.
    """

    kept = validated_record(record)
    create_cell = getattr(ctx, "create_cell", None)
    run_cell = getattr(ctx, "run_cell", None)
    cells = getattr(ctx, "cells", None)
    find_cells = getattr(cells, "find", None)
    if not callable(create_cell) or not callable(run_cell) or not callable(find_cells):
        raise TypeError("context must be a live marimo code-mode context")

    existing = cast(Sequence[_CodeModeCell], find_cells(_LENS_CELL_MARKER))
    if len(existing) > 1:
        raise LensError(
            "lens_ambiguous",
            "The notebook has multiple agent-created Lens cells. Leave one before adding another.",
        )
    if existing:
        cell_id = str(existing[0].id)
        open_lenses = open_lenses_from_cell(current_runtime_scope(), cell_id)
        if record is not None:
            kept_now = (
                open_lenses[0].record if open_lenses else _cell_record(existing[0].code)
            )
            if not isinstance(kept_now, _Unreadable) and kept_now != kept:
                raise LensError(
                    "lens_cell_exists",
                    f"The agent-managed Lens cell {cell_id} mounts "
                    f"Lens({_lens_arguments(kept_now)}). Edit that cell to change "
                    "its record.",
                )
        # Rerunning a cell replaces its open Lens and drops that Lens's Open
        # selections. A queued or running cell is already mounting one.
        holds_open_lens = bool(open_lenses)
        if not holds_open_lens and existing[0].status not in {
            "queued",
            "running",
            "disabled",
        }:
            run_cell(cell_id)
        return cell_id

    cell_id = create_cell(
        _LENS_CELL_CODE.format(arguments=_lens_arguments(kept)), hide_code=True
    )
    run_cell(cell_id)
    return str(cell_id)


def discover(context: object | None = None) -> tuple[MountedLens, ...]:
    """Return available Lens handles without creating a widget or notebook cell.

    Includes browser-ready instances in the active runtime, even when the host
    mounted them without a notebook variable. A supplied code-mode context also
    contributes Lens objects in its globals, which may not be rendered yet.
    Aliases and browser registrations for the same object produce one handle.

    Returns an empty tuple when none are available. Each handle's identity can
    be passed to connect() to select that instance. Order implies no priority.

    Raises:
        TypeError: The context lacks a globals mapping.
    """

    return _discover_candidates(context, mounted_lenses(current_runtime_scope()))


def _discover_candidates(
    context: object | None,
    browser_ready: Sequence[Lens],
) -> tuple[MountedLens, ...]:
    namespace: Mapping[str, object] | None = None
    if context is not None:
        raw_namespace = getattr(context, "globals", None)
        if not isinstance(raw_namespace, Mapping):
            raise TypeError("context must expose a globals mapping")
        namespace = cast(Mapping[str, object], raw_namespace)
    candidates = {id(lens): lens for lens in browser_ready}
    if namespace is not None:
        for value in namespace.values():
            lens = _as_lens(value)
            if lens is not None:
                candidates.setdefault(id(lens), lens)

    return tuple(
        MountedLens(
            identity=_identity(lens),
            lens=lens,
        )
        for lens in candidates.values()
    )


def connect(
    context: object | None = None,
    *,
    identity: str | None = None,
) -> MountedLens:
    """Select one of the Lens handles returned by discover().

    Pass a code-mode context to include existing Lens objects from its kernel
    globals. A unique browser-ready Lens takes priority over additional Lens
    objects in those globals. Pass an earlier handle's identity to reconnect to
    that Lens in a later kernel call.

    Raises:
        LensError: No available Lens matches, or several are available without
            a unique browser-ready Lens or an identity selecting one.
        TypeError: The context lacks a globals mapping or identity has the wrong
            type.
        ValueError: Identity is empty.
    """

    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    browser_ready = mounted_lenses(current_runtime_scope())
    mounted = _discover_candidates(context, browser_ready)
    if identity is not None:
        for lens in mounted:
            if lens.identity == identity:
                return lens
        raise LensError(
            "lens_unavailable",
            ("The requested Lens is unavailable. Connect again without an identity."),
        )
    if len(browser_ready) == 1:
        lens = browser_ready[0]
        return MountedLens(identity=_identity(lens), lens=lens)
    if len(mounted) == 1:
        return mounted[0]
    if not mounted:
        raise LensError(
            "lens_unavailable",
            "No Lens is available in the active notebook.",
        )
    raise LensError(
        "lens_ambiguous",
        (
            "The active notebook has multiple available Lens instances. "
            "Use discover() to inspect candidates and reconnect with an identity."
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
    "add_lens_cell",
    "connect",
    "discover",
    "plugin",
    "skill",
]
