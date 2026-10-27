from __future__ import annotations

import pathlib

import pytest

from tests.support.kernel import SALES, FakeNotebook


@pytest.fixture
def notebook(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path) -> FakeNotebook:
    """The ``SALES`` notebook saved as ``sales.py`` in a temporary folder."""

    return FakeNotebook(monkeypatch, tmp_path / "sales.py", dict(SALES))
