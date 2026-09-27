"""Track Lens models by runtime scope, browser readiness, and creating cell."""

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
_ORIGINS: weakref.WeakKeyDictionary[Lens, tuple[weakref.ReferenceType[object], str]] = (
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


def record_origin(lens: Lens, scope: object | None, cell_id: str | None) -> None:
    if scope is None or cell_id is None:
        return
    with _LOCK:
        _ORIGINS[lens] = (weakref.ref(scope), cell_id)


def open_lenses_from_cell(scope: object | None, cell_id: str) -> tuple[Lens, ...]:
    if scope is None:
        return ()
    with _LOCK:
        return tuple(
            lens
            for lens, (scope_ref, origin) in _ORIGINS.items()
            if scope_ref() is scope and origin == cell_id and not lens._lens_closed
        )


__all__ = [
    "mounted_lenses",
    "open_lenses_from_cell",
    "record_origin",
    "register_lens",
    "unregister_lens",
]
