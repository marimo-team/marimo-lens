"""Connect code-mode agents to Lens."""

from __future__ import annotations

import secrets
import sys
import threading
import weakref
from collections.abc import Mapping, Sequence
from textwrap import indent
from types import ModuleType
from typing import Protocol, cast

import agent_plugins

from .context import LensContext
from .errors import LensError
from .widget import Lens, _mounted_lenses

_DISTRIBUTION_NAME = "marimo-lens"
_SKILL_NAME = "marimo-lens"


def agent_plugin() -> agent_plugins.Plugin:
    """Return the Agent Plugin installed with this Lens version."""
    return agent_plugins.locate(_DISTRIBUTION_NAME)


def _agent_skill(plugin: agent_plugins.Plugin) -> agent_plugins.Skill:
    for skill in plugin.skills:
        if skill.path.name == _SKILL_NAME:
            return skill
    raise agent_plugins.AgentPluginError(
        "The marimo-lens Agent Plugin has no marimo-lens skill. Reinstall marimo-lens."
    )


def agent_skill() -> agent_plugins.Skill:
    """Return Lens's packaged Agent Skill."""
    return _agent_skill(agent_plugin())


def _module_help(summary: str) -> str:
    plugin = agent_plugin()
    skill = _agent_skill(plugin)
    tree = indent(plugin.tree(max_depth=3, max_files=50), "    ")
    return f"""{summary}

Connect to Lens inside a live marimo code-mode kernel call:

    import marimo._code_mode as cm
    import marimo_lens.agent as lens_agent

    ctx = cm.get_context()
    mounted = lens_agent.connect(ctx)
    snapshot = mounted.context()

After connect(ctx) raises LensError(code="lens_unavailable"), queue a Lens cell
in a fresh kernel call:

    import marimo._code_mode as cm
    import marimo_lens.agent as lens_agent

    async with cm.get_context() as ctx:
        lens_agent.add_lens_cell(ctx)

The installed Agent Plugin carries the complete Lens workflow and the resources
that match this package version:

{tree}

Read the Lens skill instructions at:

    {skill / "SKILL.md"}

Traverse the same resources programmatically:

    resources = lens_agent.agent_plugin()
    skill = lens_agent.agent_skill()
    print(resources)
    print(skill.body)
"""


class _CodeModeCell(Protocol):
    id: object


_IDENTITIES: weakref.WeakKeyDictionary[Lens, str] = weakref.WeakKeyDictionary()
_IDENTITIES_LOCK = threading.RLock()
_LENS_CELL_MARKER = "# marimo-lens: agent-managed Lens cell"
# Private bindings introduce no public names into marimo's dataflow graph.
_LENS_CELL_CODE = f"""\
{_LENS_CELL_MARKER}
import marimo as _mo
from marimo_lens import Lens as _Lens

_lens = _Lens()
_mo.output.append(_lens)
"""


class MountedLens:
    """A live Lens handle returned by connect().

    Its identity and Lens remain fixed for the handle's lifetime. Keep identity
    to reconnect to the same Lens in a later kernel call.
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

    def __repr__(self) -> str:
        """Return a diagnostic representation containing the opaque identity."""

        return f"MountedLens(identity={self.identity!r})"

    def context(self) -> LensContext:
        """Return a detached snapshot of the current Lens context.

        The snapshot carries its revision, bounded notebook text, selection
        references, and annotated selection PNG bytes. Read another snapshot
        after the notebook or Lens state changes.

        Raises:
            LensError: The Lens is closed.
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
            LensError: The Lens is closed.
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

    Return the existing agent-created Lens cell ID when the notebook already
    contains one. The code-mode context creates and runs a new cell when its
    async context manager exits.

    Call connect() in a later kernel call after the browser has rendered the
    cell.

    Returns:
        The existing or queued cell ID.

    Raises:
        TypeError: The context lacks the required code-mode cell APIs.
        LensError: The notebook contains several agent-created Lens cells.
    """

    create_cell = getattr(ctx, "create_cell", None)
    run_cell = getattr(ctx, "run_cell", None)
    cells = getattr(ctx, "cells", None)
    find_cells = getattr(cells, "find", None)
    if not callable(create_cell) or not callable(run_cell) or not callable(find_cells):
        raise TypeError("context must be a live marimo code-mode context")

    existing = cast(Sequence[_CodeModeCell], find_cells(_LENS_CELL_MARKER))
    if len(existing) == 1:
        return str(existing[0].id)
    if len(existing) > 1:
        raise LensError(
            "lens_ambiguous",
            "The notebook has multiple agent-created Lens cells. Leave one before adding another.",
        )

    cell_id = create_cell(_LENS_CELL_CODE, hide_code=True)
    run_cell(cell_id)
    return str(cell_id)


def connect(
    context: object | None = None,
    *,
    identity: str | None = None,
) -> MountedLens:
    """Return the Lens selected from code-mode context or browser registration.

    Pass a code-mode context to include existing Lens objects from its kernel
    globals. Pass an earlier handle's identity to reconnect to that Lens in a
    later kernel call.

    Raises:
        LensError: No available Lens matches, or several are available without
            an identity selecting one.
        TypeError: The context lacks a globals mapping or identity has the wrong
            type.
        ValueError: Identity is empty.
    """

    namespace: Mapping[str, object] | None = None
    if context is not None:
        raw_namespace = getattr(context, "globals", None)
        if not isinstance(raw_namespace, Mapping):
            raise TypeError("context must expose a globals mapping")
        namespace = cast(Mapping[str, object], raw_namespace)
    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    candidates = {id(lens): lens for lens in _mounted_lenses()}
    if namespace is not None:
        for value in namespace.values():
            lens = _as_lens(value)
            if lens is not None:
                candidates.setdefault(id(lens), lens)

    mounted = tuple(
        MountedLens(
            identity=_identity(lens),
            lens=lens,
        )
        for lens in candidates.values()
    )
    if identity is not None:
        for lens in mounted:
            if lens.identity == identity:
                return lens
        raise LensError(
            "lens_unavailable",
            ("The requested Lens is unavailable. Connect again without an identity."),
        )
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
            "Reconnect with an identity, or close or remove extra Lens instances."
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
    "agent_plugin",
    "agent_skill",
    "connect",
]


class _AgentModule(ModuleType):
    @property
    def __doc__(self) -> str | None:  # pyrefly: ignore [bad-override]
        summary = self.__dict__.get("__doc__")
        return _module_help(summary) if isinstance(summary, str) else None

    @__doc__.setter
    def __doc__(self, value: str | None) -> None:
        self.__dict__["__doc__"] = value


sys.modules[__name__].__class__ = _AgentModule
