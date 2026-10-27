"""Runtime contexts that hold UI controls, as marimo's ``get_context`` returns them."""

from __future__ import annotations

from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

import pytest


def install_context(monkeypatch: pytest.MonkeyPatch, context: Any) -> None:
    import marimo._runtime.context as context_module

    monkeypatch.setattr(context_module, "get_context", lambda: context)


def control_context(name: str, control: object) -> SimpleNamespace:
    return controls_context({name: control})


def controls_context(controls: Mapping[str, object]) -> SimpleNamespace:
    """Return a runtime where ``cell-control`` defines each control and ``cell-view`` renders them."""

    return SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-control": cell(
                    f"{', '.join(controls)} = controls()", defs=set(controls)
                ),
                "cell-view": cell(
                    f"render({', '.join(f'{key}.value' for key in controls)})",
                    refs=set(controls),
                ),
            },
            definitions={key: {"cell-control"} for key in controls},
            parents={"cell-control": set(), "cell-view": {"cell-control"}},
        ),
        globals=dict(controls),
        filename="demo.py",
        cell_id="cell-lens",
    )


def cell(
    code: str,
    *,
    defs: set[str] | None = None,
    refs: set[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        code=code,
        defs=defs or set(),
        refs=refs or set(),
        language="python",
        runtime_state="idle",
        run_result_status="success",
        stale=False,
        config=SimpleNamespace(disabled=False),
    )
