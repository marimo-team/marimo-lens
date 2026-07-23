from __future__ import annotations

from collections.abc import Iterator, Mapping
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
import traitlets

from marimo_lens._context import build_context
from marimo_lens._provenance import resolve_provenance
from marimo_lens._marimo_runtime import (
    collect_runtime_snapshot,
    runtime_cell_status,
)

from tests.support.factories import selection


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
    import marimo_lens._marimo_control_state as control_state_module

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
            cells={"cell-view": _cell("limit", refs={"limit"})},
            definitions=definitions,
            parents={"cell-view": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)
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
                "cell-limit": _cell("limit = mo.ui.slider(0, 10)", defs={"limit"}),
                "cell-widget": _cell(
                    "unrelated = TrackingWidget()",
                    defs={"unrelated"},
                ),
                "cell-view": _cell("render(limit.value)", refs={"limit"}),
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
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert [control.name for control in runtime.controls] == ["limit"]
    assert unrelated.state_reads == baseline_reads


def test_targeted_runtime_materializes_at_most_sixty_four_cells(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cells = {f"cell-{index}": _ReadCountingCell("x" * 10_000) for index in range(1_000)}
    parents = {
        f"cell-{index}": ({f"cell-{index - 1}"} if index else set())
        for index in range(1_000)
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(cells=cells, definitions={}, parents=parents),
        globals={},
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-999",))
    provenance = resolve_provenance(runtime, ["cell-999"])

    assert len(runtime.cells) == 64
    assert sum(cell.code_reads for cell in cells.values()) == 64
    assert runtime.omitted_cell_count == 936
    assert runtime.omitted_cell_ids == tuple(
        f"cell-{index}" for index in range(935, 919, -1)
    )
    assert runtime.cell_truncated_output_ids == frozenset({"cell-999"})
    assert provenance.omitted_cell_count == 936


def test_targeted_runtime_reads_only_sixteen_of_many_relevant_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    controls = {f"control_{index:02d}": _CountingControl(index) for index in range(80)}
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-view": _cell(
                    "render_controls()",
                    refs=set(controls),
                )
            },
            definitions={},
            parents={"cell-view": set()},
        ),
        globals=controls,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert len(runtime.controls) == 16
    assert sum(control.frontend_reads for control in controls.values()) == 16
    assert runtime.control_truncated_output_ids == frozenset({"cell-view"})


def test_targeted_runtime_retains_top_controls_for_each_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    controls = {
        **{f"alpha_{index:02d}": _CountingControl(index) for index in range(20)},
        **{f"beta_{index:02d}": _CountingControl(index) for index in range(20)},
    }
    alpha_names = {name for name in controls if name.startswith("alpha_")}
    beta_names = {name for name in controls if name.startswith("beta_")}
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-alpha": _cell("alpha", refs=alpha_names),
                "cell-beta": _cell("beta", refs=beta_names),
            },
            definitions={},
            parents={"cell-alpha": set(), "cell-beta": set()},
        ),
        globals=controls,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)
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


def test_targeted_runtime_uses_exact_namespace_lookups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _CountingControl(8)
    namespace = _ExactLookupMapping({"limit": control})
    context = _control_context("limit", control)
    context.globals = namespace
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert [item.name for item in runtime.controls] == ["limit"]
    assert namespace.lookups == ["limit"]
    assert control.frontend_reads == 1


def test_control_lookup_failure_is_scoped_to_its_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    good = _CountingControl(8)
    namespace = _SelectiveLookupMapping({"good": good}, failures={"bad"})
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-bad": _cell("render(bad.value)", refs={"bad"}),
                "cell-good": _cell("render(good.value)", refs={"good"}),
            },
            definitions={},
            parents={"cell-bad": set(), "cell-good": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-bad", "cell-good"))

    assert [control.name for control in runtime.controls] == ["good"]
    assert runtime.control_incomplete_output_ids == frozenset({"cell-bad"})


def test_shared_control_lookup_failure_marks_each_output_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    namespace = _SelectiveLookupMapping({}, failures={"shared"})
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-a": _cell("render(shared.value)", refs={"shared"}),
                "cell-b": _cell("render(shared.value)", refs={"shared"}),
            },
            definitions={},
            parents={"cell-a": set(), "cell-b": set()},
        ),
        globals=namespace,
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot(("cell-a", "cell-b"))

    assert runtime.controls == ()
    assert runtime.control_incomplete_output_ids == frozenset({"cell-a", "cell-b"})
    assert namespace.lookups == ["shared"]


@pytest.mark.parametrize("globals_mode", ["unreadable", "non-mapping"])
def test_incomplete_globals_mark_current_control_sampling_incomplete(
    monkeypatch: pytest.MonkeyPatch,
    globals_mode: str,
) -> None:
    control = _CountingControl("Austria")
    control_context = _control_context("country", control)
    current_context = _GlobalsFailureContext(
        control_context.graph,
        mode=globals_mode,
    )
    _install_context(monkeypatch, current_context)
    current = collect_runtime_snapshot(("cell-view",))

    assert current.control_incomplete_output_ids == frozenset({"cell-view"})
    assert current.controls == ()


def test_control_definition_cell_ids_are_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _CountingControl(8)
    definition_cells = {
        f"cell-control-{index}": _cell("shared = control()", defs={"shared"})
        for index in range(20)
    }
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                **definition_cells,
                "cell-view": _cell("render(shared.value)", refs={"shared"}),
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
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert len(runtime.controls[0].cell_ids) == 16
    assert runtime.controls[0].metadata_complete is False


def test_context_build_reuses_current_runtime_control_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _CountingControl(8)
    context = _control_context("limit", control)
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot()
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
    context = _control_context("limit", limit)
    _install_context(monkeypatch, context)

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
    import marimo_lens._marimo_control_state as control_state_module

    control = _CountingControl("\ud800")
    context = _control_context("value", control)
    _install_context(monkeypatch, context)
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
    import marimo_lens._marimo_control_state as control_state_module

    name = "x" * name_length
    control = _CountingControl("Austria")
    context = _control_context(name, control)
    _install_context(monkeypatch, context)
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

    snapshot = collect_runtime_snapshot()

    assert snapshot.available is False
    assert snapshot.cells == ()
    assert snapshot.reason == "not running in a marimo kernel"
    assert runtime_cell_status("cell-view") == "unavailable"


def test_runtime_cell_status_reads_only_exact_graph_membership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lock = _RecordingLock()
    context = SimpleNamespace(graph=_LockedGraph(lock))
    _install_context(monkeypatch, context)

    assert runtime_cell_status("cell-view") == "available"
    assert runtime_cell_status("cell-other") == "missing"
    assert lock.entries == 2


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
    assert snapshot.cells[0].runtime_state == "idle"
    assert snapshot.cells[0].run_result_status == "success"
    assert snapshot.cells[0].stale is False


def _install_context(monkeypatch: pytest.MonkeyPatch, context: Any) -> None:
    import marimo._runtime.context as context_module

    monkeypatch.setattr(context_module, "get_context", lambda: context)


def _control_context(name: str, control: object) -> SimpleNamespace:
    return SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-control": _cell(
                    f"{name} = control()",
                    defs={name},
                ),
                "cell-view": _cell(
                    f"render({name}.value)",
                    refs={name},
                ),
            },
            definitions={name: {"cell-control"}},
            parents={
                "cell-control": set(),
                "cell-view": {"cell-control"},
            },
        ),
        globals={name: control},
        filename="demo.py",
        cell_id="cell-lens",
    )


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
        runtime_state="idle",
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


class _ExactLookupMapping(Mapping[str, object]):
    def __init__(self, values: dict[str, object]) -> None:
        self._values = values
        self.lookups: list[str] = []

    def __getitem__(self, key: str) -> object:
        self.lookups.append(key)
        return self._values[key]

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("targeted runtime must not iterate context.globals")

    def __len__(self) -> int:
        raise AssertionError("targeted runtime must not size context.globals")


class _SelectiveLookupMapping(_ExactLookupMapping):
    def __init__(
        self,
        values: dict[str, object],
        *,
        failures: set[str],
    ) -> None:
        super().__init__(values)
        self._failures = failures

    def __getitem__(self, key: str) -> object:
        self.lookups.append(key)
        if key in self._failures:
            raise RuntimeError("namespace lookup failed")
        return self._values[key]


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
