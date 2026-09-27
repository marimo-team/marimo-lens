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

    def __str__(self) -> str:
        # Code-mode transports report uncaught errors as traceback text, so
        # the recovery code must appear there, not only as an attribute.
        return f"{self.code}: {super().__str__()}"


__all__ = ["LensError"]
