from __future__ import annotations

import marimo_lens


def test_public_exports_are_explicit() -> None:
    assert marimo_lens.__all__ == [
        "Lens",
        "charts",
        "context",
        "find_lens",
        "inspectors",
        "pair",
        "selection",
        "target",
        "targets",
    ]
    assert "Widget" not in marimo_lens.__all__


def test_public_exports_are_available() -> None:
    for name in marimo_lens.__all__:
        assert getattr(marimo_lens, name) is not None
