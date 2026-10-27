"""The record a Lens keeps of resolved requests: ``Record`` and ``RecordOptions``."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias, TypedDict, get_args

Keep: TypeAlias = Literal["notebook", "session"]

_KEEP: tuple[Keep, ...] = get_args(Keep)


class RecordOptions(TypedDict, total=False):
    """The record a Lens keeps, written as a plain dict.

    ``Lens(record=True)`` keeps the full record. A dict changes some of its
    fields and leaves the rest at their ``Record`` defaults:

    .. code-block:: python

        Lens(record=True)
        Lens(record={"history": False})
        Lens(record={"keep": "session", "images": False})

    The keys are ``Record``'s fields, ``keep``, ``images``, and ``history``,
    with the same meaning and checks. An unknown key raises ``TypeError``.
    """

    keep: Keep
    images: bool
    history: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class Record:
    """Keep each resolved request, what it changed, and whether the change still holds.

    ``Lens(record=True)`` keeps a ``Record()``. A ``RecordOptions`` dict such
    as ``Lens(record={"history": False})``, or a ``Record`` itself, sets some
    fields and leaves the rest at their defaults. ``Lens.record`` returns the
    ``Record`` the Lens keeps.

    Each resolved request leaves a record line with the code of every cell
    it changed. ``context.history()`` reports each change as ``in_force``,
    ``undone``, or ``unknown``, ``check()`` adds the ``LR`` rules, and
    selection labels continue after the highest recorded label.
    A Lens built with ``Lens()`` keeps open selections and requests, and a
    resolved request ends with its receipt in the browser.

    A chat request belongs to no Lens. The record of the Lens that resolves
    it keeps it, and nothing keeps it when that Lens has no record.

    Arguments:
        keep: Where the record lives. ``"notebook"`` writes it to the
            notebook's ``__marimo__/lens/`` folder in the marimo editor. In
            apps, in Pyodide, and outside marimo it keeps the record in memory
            until the kernel stops, so each app visitor sees only their own
            requests.
            ``"session"`` keeps it in memory everywhere.
        images: Keep each resolved selection's annotated PNG beside its line.
        history: Show the record in the Lens's History tab, where the
            analyst reviews resolved requests and reopens selections. Agents
            read the record through ``context.history()`` either way.

    Raises:
        ValueError: ``keep`` is not ``"notebook"`` or ``"session"``.
        TypeError: ``images`` or ``history`` is not a bool.

    Example:
        >>> Record(keep="session", images=False)
        Record(keep='session', images=False, history=True)
    """

    keep: Keep = "notebook"
    images: bool = True
    history: bool = True

    def __post_init__(self) -> None:
        if self.keep not in _KEEP:
            raise ValueError(
                f"keep must be 'notebook' or 'session', not {self.keep!r}."
            )
        for name in ("images", "history"):
            if not isinstance(getattr(self, name), bool):
                raise TypeError(f"{name} must be True or False.")
