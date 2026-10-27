"""Read the installed Lens agent briefing."""

from __future__ import annotations

import sys
from types import ModuleType

import agent_plugins

__all__: list[str] = []

# pydoc's NAME line shows this first line alone, so `help()` on this module
# opens with when an agent needs Lens. Code mode's own listing shows only the
# capability name and its import.
_SUMMARY = (
    "The analyst's requests and what earlier ones changed. Open a chat request "
    "and read the brief before working on it."
)


class _CapabilityModule(ModuleType):
    def __dir__(self) -> list[str]:
        # pydoc enumerates members four times after reading the docstring.
        # Keep the resource-backed property out of those member scans.
        return [name for name in super().__dir__() if name != "__doc__"]

    # marimo discovers this module through metadata. Read resources when help()
    # requests the briefing, so discovery and imports stay lazy.
    @property
    def __doc__(self) -> str | None:  # pyrefly: ignore [bad-override]
        summary = self.__dict__.get("__doc__")
        if not isinstance(summary, str):
            return None
        briefing = agent_plugins.read("marimo-lens")
        # Native discovery already runs in the notebook environment. Retain the
        # installed inventory and complete skill after the CLI bootstrap guidance.
        inventory = "## Plugin inventory"
        return f"{_SUMMARY}\n\n" + briefing[briefing.index(inventory) :]

    @__doc__.setter
    def __doc__(self, value: str | None) -> None:  # pyright: ignore[reportIncompatibleVariableOverride]
        self.__dict__["__doc__"] = value


sys.modules[__name__].__class__ = _CapabilityModule
