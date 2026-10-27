from __future__ import annotations

import pathlib
import textwrap
from collections.abc import Iterator, Mapping
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
import traitlets
from marimo_lens._marimo.snapshot import collect_runtime_snapshot, runtime_cell_status
from marimo_lens._notebook.provenance import resolve_provenance

from tests.support.controls import cell, control_context, install_context
from tests.support.factories import build_context, selection


class ExampleWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} };"

    count = traitlets.Int(3).tag(sync=True)


class TrackingWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} };"

    secret = traitlets.Unicode("unrelated-secret").tag(sync=True)

    def __init__(self) -> None:
        self.state_reads = 0
        super().__init__()

    def get_state(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.state_reads += 1
        return super().get_state(*args, **kwargs)


def test_runtime_collects_cells_edges_and_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    chart = object()
    limit = mo.ui.slider(0, 10, value=4, label="Limit")
    widget = ExampleWidget()
    wrapped = mo.ui.anywidget(ExampleWidget())
    cells = {
        "cell-data": cell("chart = make_chart()", defs={"chart"}),
        "cell-limit": cell("limit = mo.ui.slider(0, 10)", defs={"limit"}),
        "cell-widget": cell("widget = ExampleWidget()", defs={"widget"}),
        "cell-wrapped": cell(
            "wrapped = mo.ui.anywidget(ExampleWidget())",
            defs={"wrapped"},
        ),
        "cell-view": cell(
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
    install_context(monkeypatch, context)

    snapshot = collect_runtime_snapshot(tuple(context.graph.cells))

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
    controls = {control.name: control for control in snapshot.controls}
    assert controls["limit"].value == 4
    assert controls["limit"].cell_ids == ("cell-limit",)
    assert controls["widget"].value is None
    assert controls["widget"].sensitive is True
    assert controls["widget"].kind == "anywidget"
    assert controls["wrapped"].value is None
    assert controls["wrapped"].sensitive is True
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
            cells={"cell-view": cell("42")},
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
    install_context(monkeypatch, context)

    try:
        runtime = collect_runtime_snapshot(tuple(context.graph.cells))
        lens_context = lens.context()
    finally:
        lens.close()

    assert runtime.controls == ()
    assert lens_context.images == {}
    assert hostile.probes == []


def test_runtime_keeps_late_controls_until_context_relevance_is_known(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    namespace: dict[str, object] = {
        f"unrelated_{index}": SimpleNamespace(value=index) for index in range(80)
    }
    namespace["limit"] = _CountingControl(8)
    definitions = {
        **{f"unrelated_{index}": (f"cell-other-{index}",) for index in range(80)},
        "limit": ("cell-view",),
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={"cell-view": cell("limit", refs={"limit"})},
            definitions=definitions,
            parents={"cell-view": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert [control.name for control in runtime.controls] == ["limit"]
    assert "controls" not in references
    assert "`limit`" in text
    assert "unrelated_0" not in text


def test_targeted_runtime_never_reads_unrelated_widget_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    limit = mo.ui.slider(0, 10, value=4)
    unrelated = TrackingWidget()
    baseline_reads = unrelated.state_reads
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-limit": cell("limit = mo.ui.slider(0, 10)", defs={"limit"}),
                "cell-widget": cell(
                    "unrelated = TrackingWidget()",
                    defs={"unrelated"},
                ),
                "cell-view": cell("render(limit.value)", refs={"limit"}),
            },
            definitions={
                "limit": {"cell-limit"},
                "unrelated": {"cell-widget"},
            },
            parents={
                "cell-limit": set(),
                "cell-widget": set(),
                "cell-view": {"cell-limit"},
            },
        ),
        globals={"limit": limit, "unrelated": unrelated},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert [control.name for control in runtime.controls] == ["limit"]
    assert unrelated.state_reads == baseline_reads


def test_runtime_snapshot_keeps_the_selected_closure_within_the_notebook_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cells = {f"cell-{index}": _ReadCountingCell("x" * 10_000) for index in range(1_200)}
    parents = {
        f"cell-{index}": ({f"cell-{index - 1}"} if index else set())
        for index in range(1_200)
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(cells=cells, definitions={}, parents=parents),
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-1199",))
    provenance = resolve_provenance(runtime, ["cell-1199"])

    assert len(runtime.cells) == 1_000
    assert {cell.id for cell in runtime.cells} == {
        f"cell-{index}" for index in range(200, 1_200)
    }
    assert sum(cell.code_reads for cell in cells.values()) == 1_000
    assert runtime.omitted_cell_count == 200
    assert runtime.omitted_cell_ids == tuple(
        f"cell-{index}" for index in range(199, 183, -1)
    )
    assert runtime.cell_truncated_output_ids == frozenset({"cell-1199"})
    assert runtime.available_cell_ids == frozenset({"cell-1199"})
    assert len(provenance.cells) == 64
    assert provenance.omitted_cell_count == 1_136


def test_runtime_snapshot_keeps_unrelated_cells_after_the_selected_closure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-other": cell("other = 1", defs={"other"}),
                "cell-data": cell("data = 1", defs={"data"}),
                "cell-view": cell("render(data)", refs={"data"}),
            },
            definitions={},
            parents={
                "cell-other": set(),
                "cell-data": set(),
                "cell-view": {"cell-data"},
            },
        ),
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert [cell.id for cell in runtime.cells] == [
        "cell-other",
        "cell-data",
        "cell-view",
    ]
    assert runtime.available_cell_ids == frozenset({"cell-view"})
    assert runtime.omitted_cell_count == 0


def test_runtime_snapshot_reads_names_and_order_during_a_code_mode_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo._ast.cell import CellConfig
    from marimo._messaging.notebook.document import (
        NotebookCell,
        NotebookDocument,
        notebook_document_context,
    )
    from marimo._types.ids import CellId_t

    function = "def net_by_store(sales):\n    return sales"
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-view": cell("render(data)", refs={"data"}),
                "cell-data": cell("data = 1", defs={"data"}),
                "cell-fn": cell(function, defs={"net_by_store"}),
            },
            definitions={},
            parents={"cell-data": set(), "cell-view": {"cell-data"}, "cell-fn": set()},
        ),
        globals={"__file__": "/workspace/renamed.py"},
        filename="/workspace/original.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    document = NotebookDocument(
        [
            NotebookCell(CellId_t("cell-data"), "data = 1", "load_data", CellConfig()),
            NotebookCell(CellId_t("cell-view"), "render(data)", "_", CellConfig()),
            # marimo names a top-level function cell after it, with a "*" prefix.
            NotebookCell(CellId_t("cell-fn"), function, "*net_by_store", CellConfig()),
        ]
    )

    without_document = collect_runtime_snapshot(tuple(context.graph.cells))
    with notebook_document_context(document):
        with_document = collect_runtime_snapshot(tuple(context.graph.cells))

    assert [(cell.id, cell.name) for cell in without_document.cells] == [
        ("cell-view", None),
        ("cell-data", None),
        ("cell-fn", None),
    ]
    assert [(cell.id, cell.name) for cell in with_document.cells] == [
        ("cell-data", "load_data"),
        ("cell-view", None),
        ("cell-fn", "net_by_store"),
    ]
    assert with_document.filename == "/workspace/renamed.py"


def test_targeted_runtime_preserves_membership_for_omitted_producers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cell_ids = tuple(f"cell-{index}" for index in range(1_001))
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={cell_id: _ReadCountingCell("value = 1") for cell_id in cell_ids},
            definitions={},
            parents={cell_id: set() for cell_id in cell_ids},
        ),
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(cell_ids)

    assert len(runtime.cells) == 1_000
    assert runtime.available_cell_ids == frozenset(cell_ids)
    assert runtime.omitted_cell_ids == ("cell-1000",)
    assert runtime.cell_truncated_output_ids == frozenset({"cell-1000"})


def test_targeted_runtime_retains_top_controls_for_each_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    controls = {
        **{f"alpha_{index:02d}": _CountingControl(index) for index in range(20)},
        **{f"beta_{index:02d}": _CountingControl(index) for index in range(20)},
    }
    alpha_names = {name for name in controls if name.startswith("alpha_")}
    beta_names = {name for name in controls if name.startswith("beta_")}
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-alpha": cell("alpha", refs=alpha_names),
                "cell-beta": cell("beta", refs=beta_names),
            },
            definitions={},
            parents={"cell-alpha": set(), "cell-beta": set()},
        ),
        globals=controls,
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-alpha", "cell-beta"))

    assert [control.name for control in runtime.controls] == [
        *(f"alpha_{index:02d}" for index in range(16)),
        *(f"beta_{index:02d}" for index in range(16)),
    ]
    assert sum(control.frontend_reads for control in controls.values()) == 32
    assert runtime.control_truncated_output_ids == frozenset(
        {"cell-alpha", "cell-beta"}
    )


def test_control_lookup_failure_is_scoped_to_its_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    good = _CountingControl(8)
    namespace = _SelectiveLookupMapping({"good": good}, failures={"bad"})
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-bad": cell("render(bad.value)", refs={"bad"}),
                "cell-good": cell("render(good.value)", refs={"good"}),
            },
            definitions={},
            parents={"cell-bad": set(), "cell-good": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-bad", "cell-good"))

    assert [control.name for control in runtime.controls] == ["good"]
    assert runtime.control_incomplete_output_ids == frozenset({"cell-bad"})

    _, bad_text = build_context(
        runtime,
        [selection(output_cell_id="cell-bad")],
        revision=1,
        current_selection_id="selection-1",
    )
    _, good_text = build_context(
        runtime,
        [selection(output_cell_id="cell-good")],
        revision=1,
        current_selection_id="selection-1",
    )

    assert "Control sampling could not read runtime values for `cell-bad`" in bad_text
    assert "Control sampling could not read runtime values" not in good_text


def test_shared_control_lookup_failure_marks_each_output_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    namespace = _SelectiveLookupMapping({}, failures={"shared"})
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-a": cell("render(shared.value)", refs={"shared"}),
                "cell-b": cell("render(shared.value)", refs={"shared"}),
            },
            definitions={},
            parents={"cell-a": set(), "cell-b": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-a", "cell-b"))

    assert runtime.controls == ()
    assert runtime.control_incomplete_output_ids == frozenset({"cell-a", "cell-b"})
    assert namespace.lookups.count("shared") == 1


@pytest.mark.parametrize("globals_mode", ["unreadable", "non-mapping"])
def test_incomplete_globals_mark_current_control_sampling_incomplete(
    monkeypatch: pytest.MonkeyPatch,
    globals_mode: str,
) -> None:
    control = _CountingControl("Austria")
    country_context = control_context("country", control)
    current_context = _GlobalsFailureContext(
        country_context.graph,
        mode=globals_mode,
    )
    install_context(monkeypatch, current_context)
    current = collect_runtime_snapshot(("cell-view",))

    assert current.control_incomplete_output_ids == frozenset({"cell-view"})
    assert current.controls == ()


def test_control_definition_cell_ids_are_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    control = _CountingControl(8)
    definition_cells = {
        f"cell-control-{index}": cell("shared = control()", defs={"shared"})
        for index in range(20)
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                **definition_cells,
                "cell-view": cell("render(shared.value)", refs={"shared"}),
            },
            parents={
                **{cell_id: set() for cell_id in definition_cells},
                "cell-view": set(definition_cells),
            },
        ),
        globals={"shared": control},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert len(runtime.controls[0].cell_ids) == 16
    assert runtime.controls[0].metadata_complete is False


def test_context_build_reuses_current_runtime_control_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    control = _CountingControl(8)
    context = control_context("limit", control)
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(tuple(context.graph.cells))
    build_context(
        runtime,
        [selection(), selection(selection_id="selection-2", label="S2")],
        revision=2,
        current_selection_id="selection-2",
    )

    assert control.frontend_reads == 1


def test_long_control_label_preserves_current_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    limit = mo.ui.slider(0, 10, value=1, label="L" * 1_001)
    context = control_context("limit", limit)
    install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-view",))
    _, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].complete is True
    assert runtime.controls[0].metadata_complete is False
    assert runtime.controls[0].value == 1
    assert "`limit`" in text
    assert "value: 1" in text


def test_invalid_control_strings_are_redacted_in_current_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    control = _CountingControl("\ud800")
    context = control_context("value", control)
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))
    _, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].complete is False
    assert runtime.controls[0].sensitive is True
    assert "`value`" in text
    assert "[redacted]" in text


@pytest.mark.parametrize("name_length", [129, 1_001])
def test_long_control_names_are_bounded_in_current_context_text(
    monkeypatch: pytest.MonkeyPatch,
    name_length: int,
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    name = "x" * name_length
    control = _CountingControl("Austria")
    context = control_context(name, control)
    install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))
    _, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert [control.name for control in runtime.controls] == [name]
    context_before_source = text.split("## Relevant cells", 1)[0]
    assert name not in context_before_source


def test_runtime_reports_unavailable_kernel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo._runtime.context as context_module
    from marimo._runtime.context.types import ContextNotInitializedError

    def missing() -> Any:
        raise ContextNotInitializedError

    monkeypatch.setattr(context_module, "get_context", missing)

    snapshot = collect_runtime_snapshot(())

    assert snapshot.available is False
    assert snapshot.cells == ()
    assert snapshot.reason == "not running in a marimo kernel"
    assert runtime_cell_status("cell-view") == "unavailable"


def test_runtime_cell_status_reads_only_exact_graph_membership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lock = _RecordingLock()
    context = SimpleNamespace(graph=_LockedGraph(lock))
    install_context(monkeypatch, context)

    assert runtime_cell_status("cell-view") == "available"
    assert runtime_cell_status("cell-other") == "missing"


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
    install_context(monkeypatch, context)

    snapshot = collect_runtime_snapshot(("cell-view",))

    assert snapshot.cells[0].id == "cell-view"
    assert snapshot.cells[0].runtime_state == "idle"
    assert snapshot.cells[0].run_result_status == "success"
    assert snapshot.cells[0].stale is False


class _RecordingLock:
    def __init__(self) -> None:
        self.active = False

    def __enter__(self) -> None:
        self.active = True

    def __exit__(self, *_args: object) -> None:
        self.active = False


class _LockedGraph:
    def __init__(self, lock: _RecordingLock) -> None:
        self.lock = lock

    @property
    def cells(self) -> dict[str, _LockedCell]:
        assert self.lock.active
        return {"cell-view": _LockedCell(self.lock)}

    @property
    def definitions(self) -> dict[str, set[str]]:
        assert self.lock.active
        return {}

    @property
    def parents(self) -> dict[str, set[str]]:
        assert self.lock.active
        return {"cell-view": set()}


class _LockedCell:
    def __init__(self, lock: _RecordingLock) -> None:
        self._lock = lock

    def _read(self, value: Any) -> Any:
        assert self._lock.active
        return value

    @property
    def code(self) -> str:
        return self._read("42")

    @property
    def defs(self) -> set[str]:
        return self._read(set())

    @property
    def refs(self) -> set[str]:
        return self._read(set())

    @property
    def language(self) -> str:
        return self._read("python")

    @property
    def runtime_state(self) -> str:
        return self._read("idle")

    @property
    def run_result_status(self) -> str:
        return self._read("success")

    @property
    def stale(self) -> bool:
        return self._read(False)


class _ReadCountingCell:
    def __init__(self, code: str) -> None:
        self._code = code
        self.code_reads = 0
        self.defs: set[str] = set()
        self.refs: set[str] = set()
        self.language = "python"
        self.runtime_state = "idle"
        self.run_result_status = "success"
        self.stale = False

    @property
    def code(self) -> str:
        self.code_reads += 1
        return self._code


class _SelectiveLookupMapping(Mapping[str, object]):
    def __init__(self, values: dict[str, object], *, failures: set[str]) -> None:
        self._values = values
        self._failures = failures
        self.lookups: list[str] = []

    def __getitem__(self, key: str) -> object:
        self.lookups.append(key)
        if key in self._failures:
            raise RuntimeError("namespace lookup failed")
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("targeted runtime must not iterate context.globals")

    def __len__(self) -> int:
        raise AssertionError("targeted runtime must not size context.globals")


class _GlobalsFailureContext:
    def __init__(self, graph: object, *, mode: str) -> None:
        self.graph = graph
        self.filename = "demo.py"
        self.cell_id = "cell-lens"
        self._mode = mode

    @property
    def globals(self) -> object:
        if self._mode == "unreadable":
            raise RuntimeError("globals unavailable")
        return []


class _CountingControl:
    __module__ = "marimo._plugins.ui._core.test"

    def __init__(self, value: object) -> None:
        self._args = SimpleNamespace(
            component_name="marimo-slider",
            label="Limit",
            args={},
        )
        self._value = value
        self._frontend_value = value
        self.frontend_reads = 0

    @property
    def _value_frontend(self) -> object:
        self.frontend_reads += 1
        return self._frontend_value


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


def test_document_only_cells_share_the_notebook_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo._ast.cell import CellConfig
    from marimo._messaging.notebook.document import (
        NotebookCell,
        NotebookDocument,
        notebook_document_context,
    )
    from marimo._types.ids import CellId_t

    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={"cell-run": cell("x = 1", defs={"x"})},
            definitions={},
            parents={"cell-run": set()},
        ),
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    install_context(monkeypatch, context)
    document = NotebookDocument(
        [
            NotebookCell(CellId_t("cell-run"), "x = 1", "_", CellConfig()),
            *(
                NotebookCell(CellId_t(f"cell-{index}"), "y = (", "_", CellConfig())
                for index in range(1_005)
            ),
        ]
    )

    with notebook_document_context(document):
        snapshot = collect_runtime_snapshot(tuple(context.graph.cells))

    assert len(snapshot.cells) + len(snapshot.unregistered) == 1_000
    assert snapshot.omitted_cell_count == 6
    assert snapshot.document is True


def test_a_notebook_file_names_a_top_level_function_cell_as_written(
    tmp_path: pathlib.Path,
) -> None:
    from marimo_lens._marimo.notebook_file import notebook_file_snapshot

    path = tmp_path / "sales.py"
    path.write_text(
        textwrap.dedent(
            """
            import marimo

            app = marimo.App()


            @app.function
            def net_by_store(sales):
                return sales


            if __name__ == "__main__":
                app.run()
            """
        )
    )

    snapshot = notebook_file_snapshot(path)

    assert [cell.name for cell in snapshot.cells] == ["net_by_store"]
