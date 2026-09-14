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

from ._marimo_runtime import current_runtime_scope
from ._registry import mounted_lenses
from .activity import ActivityHandle
from .context import LensContext, SelectionReference
from .errors import LensError
from .trail import TrailStep
from .widget import Lens

_DISTRIBUTION_NAME = "marimo-lens"
_SKILL_NAME = "marimo-lens"


def agent_plugin() -> agent_plugins.Plugin:
    """Return the Agent Plugin installed with this Lens version."""
    return agent_plugins.locate(_DISTRIBUTION_NAME)


def agent_skill() -> agent_plugins.Skill:
    """Return Lens's packaged Agent Skill."""
    return agent_plugin().skill(_SKILL_NAME)


def _module_help(summary: str) -> str:
    plugin = agent_plugin()
    skill = plugin.skill(_SKILL_NAME)
    tree = indent(plugin.tree(max_depth=3, max_files=50), "    ")
    return f"""{summary}

Connect to Lens inside a live marimo code-mode kernel call:

    import marimo._code_mode as cm
    import marimo_lens.agent as lens_agent

    ctx = cm.get_context()
    mounted = lens_agent.connect(ctx)

connect() reuses authored and automatically mounted Lens instances. Call
lens_agent.discover(ctx) to inspect available handles and choose an identity
when several exist.

Default to a colleague's voice in chat, activity, popovers, and summaries:
show what you changed or found, why it matters, and what we could look at next.
Use "I" for work you actually did and "let's" for shared exploration. On a
read-only tour, describe existing findings without claiming you changed them.
Keep labels concrete ("Duplicates removed", "Growth exceeds capacity") and
messages conversational ("This case exceeds capacity. Let's look at the trial
next."). Assume the user's competence; use a teaching tone when requested.
Avoid lesson framing, quizzes, and "Now you will learn" phrasing.

Quick notebook walkthrough (complete workflow):
- Reuse this loaded capability. No additional Lens skill, recipe, context(),
  selection, or image calls are needed for a text/data walkthrough.
- If the route is unknown, inspect a compact outline of ctx.cells (id, name,
  status, and first code line). Batch-read only 3-5 useful landmark cells,
  their errors, and the relevant live values in ctx.globals. Reuse verified
  context already available in the conversation.
- Explain the question, evidence, main result, and next step in reading order.
  Show it as soon as those landmarks are verified; don't audit the whole notebook.

    mounted.show_trail([
        {{"cell_id": "<verified cell ID>", "label": "What we're checking",
          "message": "<what you changed or found, and why it matters>"}},
        # Add the other verified landmarks in reading order.
    ])

show_trail(steps) returns None. It accepts 1-16 steps with cell_id, label
(up to 40 UTF-16 units), and optional message (up to 1,000). The small popover
stepper holds until the user navigates or dismisses it. Nothing is saved.
Changing referenced cells or their inputs ends the walkthrough. Return control
after showing it; no sleeps, captures, polling, or timing loops are needed.
Do not edit or rerun cells for a walkthrough unless the user asks.

For selection work, read snapshot = mounted.context() and the full skill below.
After verifying an addressed request, pass summary= to mounted.resolve() with
what changed and what you checked. Lens displays it beside the original request
in History. One batch shares a summary; resolve separately when outcomes differ.
Keep activity visible through verification; reveal replaces it directly.
Call reveal() then resolve() in the same kernel call with the captured revision.
The browser shows the reveal before the receipt while History updates immediately.

If Lens is still rendering, end the kernel call and retry after it is ready.
When no Lens exists, queue a Lens cell in a fresh kernel call:

    import marimo._code_mode as cm
    import marimo_lens.agent as lens_agent

    async with cm.get_context() as ctx:
        lens_agent.add_lens_cell(ctx)

The installed Agent Plugin carries the complete Lens workflow and the resources
that match this package version:

{tree}

For selection work, images, or authoring Lens targets, read the skill at:

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
        target: str | SelectionReference,
        *,
        expected_revision: int | None = None,
        duration_ms: int | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> ActivityHandle:
        """Show one cell or selection as the current work target.

        Pass a LensContext revision with a SelectionReference. Leave duration_ms
        unset to keep activity visible until stop_activity() or another
        attention event replaces it. A supplied duration clears the activity
        after that hold.

        Raises:
            LensError: The Lens is closed, a selection revision changed, a
                selection is missing, or the runtime cannot resolve a cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        return self._lens.start_activity(
            target,
            expected_revision=expected_revision,
            duration_ms=duration_ms,
            label=label,
            message=message,
        )

    def stop_activity(self, activity: ActivityHandle) -> None:
        """Stop activity when ``activity`` still owns the presentation.

        Raises:
            LensError: The Lens is closed.
            TypeError: The argument is not a string activity handle.
            ValueError: The handle is empty or exceeds its size limit.
        """

        self._lens.stop_activity(activity)

    def resolve(
        self,
        selection_ids: str | Sequence[str],
        *,
        expected_revision: int,
        summary: str | None = None,
    ) -> int:
        """Move verified selections to History and return the new revision.

        Include a user-facing summary of what changed and what you verified,
        up to 240 UTF-16 code units. Lens stores it beside the original request
        in each History entry. Batch selections that share an outcome; resolve
        separately with distinct summaries when outcomes differ. If verification
        required no change, summarize the finding and why it answers the request.

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

    def show_trail(self, steps: Sequence[TrailStep]) -> None:
        """Show a transient walkthrough with a popover stepper.

        Each step has cell_id, label, and an optional message. See
        Lens.show_trail() for bounds and lifecycle.
        """
        self._lens.show_trail(steps)

    def reveal(
        self,
        target: str | SelectionReference,
        *,
        expected_revision: int | None = None,
        duration_ms: int,
        label: str | None = None,
        message: str | None = None,
    ) -> None:
        """Bring one exact cell or selection into view for the supplied hold.

        Pass a LensContext revision with a SelectionReference. Reveal replaces
        current activity. Call reveal() before resolve() with the same captured
        revision in one kernel call. History retains the target, and the
        browser presents the resolution receipt after the reveal ends.

        Raises:
            LensError: The Lens is closed, a selection revision changed, a
                selection is missing, or the runtime cannot resolve a cell.
            TypeError: An argument has the wrong type.
            ValueError: An argument is outside its accepted range.
        """

        self._lens.reveal(
            target,
            expected_revision=expected_revision,
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

    namespace: Mapping[str, object] | None = None
    if context is not None:
        raw_namespace = getattr(context, "globals", None)
        if not isinstance(raw_namespace, Mapping):
            raise TypeError("context must expose a globals mapping")
        namespace = cast(Mapping[str, object], raw_namespace)
    candidates = {id(lens): lens for lens in mounted_lenses(current_runtime_scope())}
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
    globals. Pass an earlier handle's identity to reconnect to that Lens in a
    later kernel call.

    Raises:
        LensError: No available Lens matches, or several are available without
            an identity selecting one.
        TypeError: The context lacks a globals mapping or identity has the wrong
            type.
        ValueError: Identity is empty.
    """

    if identity is not None:
        if not isinstance(identity, str):
            raise TypeError("identity must be a string or None")
        if not identity:
            raise ValueError("identity must not be empty")

    mounted = discover(context)
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
    "agent_plugin",
    "agent_skill",
    "connect",
    "discover",
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
