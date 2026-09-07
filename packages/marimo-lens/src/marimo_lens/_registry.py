"""Track displayed Lens models within their owning runtime scope."""

from __future__ import annotations

import threading
import weakref
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .widget import Lens

_LOCK = threading.RLock()
_LENSES: weakref.WeakKeyDictionary[Lens, weakref.ReferenceType[object]] = (
    weakref.WeakKeyDictionary()
)


def mounted_lenses(scope: object | None) -> tuple[Lens, ...]:
    if scope is None:
        return ()
    with _LOCK:
        return tuple(
            lens for lens, scope_ref in _LENSES.items() if scope_ref() is scope
        )


def register_lens(lens: Lens, scope: object | None) -> None:
    if scope is None:
        return
    with _LOCK:
        _LENSES[lens] = weakref.ref(scope)


def unregister_lens(lens: Lens) -> None:
    with _LOCK:
        _LENSES.pop(lens, None)


__all__ = ["mounted_lenses", "register_lens", "unregister_lens"]
