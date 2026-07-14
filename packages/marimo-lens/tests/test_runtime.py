from __future__ import annotations

from collections.abc import Iterator, Mapping
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
import traitlets

from marimo_lens._context import build_context
from marimo_lens._runtime import (
    _safe_value,
    collect_runtime_snapshot,
    serialize_controls,
)

from tests.support.factories import selection


class ExampleWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} };"

    count = traitlets.Int(3).tag(sync=True)


def test_runtime_collects_cells_edges_and_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    chart = object()
    limit = mo.ui.slider(0, 10, value=4, label="Limit")
    widget = ExampleWidget()
    wrapped = mo.ui.anywidget(ExampleWidget())
    cells = {
        "cell-data": _cell("chart = make_chart()", defs={"chart"}),
        "cell-limit": _cell("limit = mo.ui.slider(0, 10)", defs={"limit"}),
        "cell-widget": _cell("widget = ExampleWidget()", defs={"widget"}),
        "cell-wrapped": _cell(
            "wrapped = mo.ui.anywidget(ExampleWidget())",
            defs={"wrapped"},
        ),
        "cell-view": _cell(
            "mo.vstack([chart, limit, widget, wrapped])",
            refs={"chart", "limit", "widget", "wrapped", "mo"},
        ),
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells=cells,
            definitions={
                "chart": {"cell-data"},
                "limit": {"cell-limit"},
                "widget": {"cell-widget"},
                "wrapped": {"cell-wrapped"},
            },
            parents={
                "cell-data": set(),
                "cell-limit": set(),
                "cell-widget": set(),
                "cell-wrapped": set(),
                "cell-view": {
                    "cell-data",
                    "cell-limit",
                    "cell-widget",
                    "cell-wrapped",
                },
            },
        ),
        globals={
            "chart": chart,
            "limit": limit,
            "widget": widget,
            "wrapped": wrapped,
        },
        filename="/workspace/demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    snapshot = collect_runtime_snapshot()

    assert snapshot.available is True
    assert snapshot.filename == "/workspace/demo.py"
    view = next(cell for cell in snapshot.cells if cell.id == "cell-view")
    assert view.upstream_cell_ids == (
        "cell-data",
        "cell-limit",
        "cell-widget",
        "cell-wrapped",
    )
    assert view.refs == ("chart", "limit", "mo", "widget", "wrapped")
    controls = {
        control.name: control
        for control in serialize_controls(snapshot.controls).controls
    }
    assert controls["limit"].value == 4
    assert controls["limit"].cell_ids == ("cell-limit",)
    assert controls["widget"].value["count"] == 3
    assert controls["widget"].kind == "anywidget"
    assert controls["wrapped"].value["count"] == 3
    assert controls["wrapped"].cell_ids == ("cell-wrapped",)
    assert controls["wrapped"].kind == "anywidget"


def test_runtime_and_lens_context_do_not_probe_unrelated_globals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo
    from marimo_lens import Lens

    hostile = _HostileGlobal()
    lens = Lens()
    wrapped_lens = mo.ui.anywidget(lens)
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={"cell-view": _cell("42")},
            definitions={},
            parents={"cell-view": set()},
        ),
        globals={
            "hostile": hostile,
            "lens_widget": lens,
            "lens": wrapped_lens,
        },
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    try:
        runtime = collect_runtime_snapshot()
        lens_context = lens.context()
    finally:
        lens.close()

    assert runtime.controls == ()
    assert lens_context.images == ()
    assert hostile.probes == []


def test_runtime_keeps_late_controls_until_context_relevance_is_known(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._runtime as runtime_module

    namespace = {
        f"unrelated_{index}": SimpleNamespace(value=index) for index in range(80)
    }
    namespace["limit"] = SimpleNamespace(value=8)
    definitions = {
        **{f"unrelated_{index}": (f"cell-other-{index}",) for index in range(80)},
        "limit": ("cell-view",),
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={"cell-view": _cell("limit", refs={"limit"})},
            definitions=definitions,
            parents={"cell-view": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)
    monkeypatch.setattr(runtime_module, "_is_ui_element", lambda _value: True)
    monkeypatch.setattr(
        runtime_module,
        "_ui_identity",
        lambda _value: ("slider", ""),
    )

    runtime = collect_runtime_snapshot()
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert len(runtime.controls) == 81
    assert "controls" not in references
    assert "`limit`" in text
    assert "unrelated_0" not in text


def test_runtime_reports_unavailable_kernel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo._runtime.context as context_module
    from marimo._runtime.context.types import ContextNotInitializedError

    def missing() -> Any:
        raise ContextNotInitializedError

    monkeypatch.setattr(context_module, "get_context", missing)

    snapshot = collect_runtime_snapshot()

    assert snapshot.available is False
    assert snapshot.cells == ()
    assert snapshot.reason == "not running in a marimo kernel"


def test_runtime_copies_graph_structures_while_holding_its_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lock = _RecordingLock()
    graph = _LockedGraph(lock)
    context = SimpleNamespace(
        graph=graph,
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    snapshot = collect_runtime_snapshot()

    assert lock.entries == 1
    assert snapshot.cells[0].id == "cell-view"


def test_safe_value_stops_iterating_after_the_item_limit() -> None:
    value = _CountingMapping()

    result = _safe_value(value)

    assert value.items_visited == 21
    assert result["..."] == "more items omitted"


def test_safe_value_does_not_treat_shared_values_as_cycles() -> None:
    shared = {"value": 3}

    result = _safe_value([shared, shared])

    assert result == [{"value": 3}, {"value": 3}]


def _install_context(monkeypatch: pytest.MonkeyPatch, context: Any) -> None:
    import marimo._runtime.context as context_module

    monkeypatch.setattr(context_module, "get_context", lambda: context)


def _cell(
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
        run_result_status="success",
        stale=False,
        config=SimpleNamespace(disabled=False),
    )


class _RecordingLock:
    def __init__(self) -> None:
        self.active = False
        self.entries = 0

    def __enter__(self) -> None:
        self.active = True
        self.entries += 1

    def __exit__(self, *_args: object) -> None:
        self.active = False


class _LockedGraph:
    def __init__(self, lock: _RecordingLock) -> None:
        self.lock = lock

    @property
    def cells(self) -> dict[str, SimpleNamespace]:
        assert self.lock.active
        return {"cell-view": _cell("42")}

    @property
    def definitions(self) -> dict[str, set[str]]:
        assert self.lock.active
        return {}

    @property
    def parents(self) -> dict[str, set[str]]:
        assert self.lock.active
        return {"cell-view": set()}


class _CountingMapping(Mapping[str, int]):
    def __init__(self) -> None:
        self.items_visited = 0

    def __getitem__(self, key: str) -> int:
        return int(key)

    def __iter__(self) -> Iterator[str]:
        for index in range(10_000):
            self.items_visited += 1
            yield str(index)

    def __len__(self) -> int:
        return 10_000


class _HostileGlobal:
    def __init__(self) -> None:
        self.probes: list[str] = []

    @property
    def _marimo_lens_widget(self) -> bool:
        self.probes.append("_marimo_lens_widget")
        raise RuntimeError("unrelated marker property was read")

    @property
    def widget(self) -> object:
        self.probes.append("widget")
        raise RuntimeError("unrelated widget property was read")
