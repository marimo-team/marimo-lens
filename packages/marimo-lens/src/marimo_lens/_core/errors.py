"""Errors that Lens operations raise, and the refusals of its state transitions."""

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


def revision_conflict(expected: int, current: int) -> LensError:
    """Return the error for a guarded call that named an outdated revision."""

    return LensError(
        "revision_conflict",
        f"Expected Lens revision {expected}, but the current revision is {current}. "
        "Each resolve and each selection change advances it, so pass the "
        "revision the last call returned, or read fresh context.",
        revision=current,
    )


def require_cell(status: str, *, revision: int) -> None:
    """Raise unless a cell status from the runtime is ``available``."""

    if status == "unavailable":
        raise LensError(
            "runtime_unavailable",
            "Lens cannot inspect the active marimo runtime.",
            revision=revision,
        )
    if status == "missing":
        raise LensError(
            "cell_not_found",
            "The active marimo dataflow graph has no cell with this ID.",
            revision=revision,
        )


class Rejection(ValueError):
    """A refused change, with a stable code that callers branch on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
