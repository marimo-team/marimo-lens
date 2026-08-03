"""Public errors raised by :class:`marimo_lens.Lens`."""

from __future__ import annotations


class LensError(RuntimeError):
    """Report a Lens operation that could not be applied.

    Attributes:
        code: Stable machine-readable failure code.
        revision: Current Lens selection revision when one is available.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        revision: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.revision = revision


__all__ = ["LensError"]
