from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest


def _install_context(monkeypatch: pytest.MonkeyPatch, ctx: Any) -> None:
    import marimo._runtime.context as context

    monkeypatch.setattr(context, "get_context", lambda: ctx)


def _runtime_context(
    globals: dict[str, Any],
    *,
    query_params: Any = None,
    argv: list[str] | None = None,
    display_sales: bool = False,
) -> SimpleNamespace:
    cells = {
        "cell-data": _cell(
            defs={"sales"},
            refs={"pd"},
            code="sales = pd.DataFrame(...)",
        ),
        "cell-config": _cell(
            defs={"threshold"},
            refs=set(),
            code="threshold = 10",
        ),
        "cell-view": _cell(
            defs={"view"},
            refs={"sales", "threshold"},
            code="view = mo.ui.table(sales)",
            output=globals.get("sales") if display_sales else None,
        ),
    }
    graph = SimpleNamespace(
        cells=cells,
        definitions={
            "sales": {"cell-data"},
            "threshold": {"cell-config"},
            "view": {"cell-view"},
        },
        children={"cell-data": {"cell-view"}, "cell-config": {"cell-view"}},
    )
    return SimpleNamespace(
        graph=graph,
        globals=globals,
        cell_id="cell-lens",
        filename="demo.py",
        query_params=query_params or {"tab": "review"},
        argv=argv or ["demo.py"],
    )


def _cell(
    *,
    defs: set[str],
    refs: set[str],
    code: str,
    output: Any = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        defs=defs,
        refs=refs,
        language="python",
        run_result_status="success",
        stale=False,
        config=SimpleNamespace(disabled=False),
        code=code,
        output=output,
    )
