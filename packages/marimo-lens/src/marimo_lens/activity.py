"""Public activity ownership returned by :class:`marimo_lens.Lens`."""

from typing import NewType

ActivityHandle = NewType("ActivityHandle", str)


__all__ = ["ActivityHandle"]
