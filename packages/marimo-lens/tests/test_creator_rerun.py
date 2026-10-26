from __future__ import annotations

import asyncio
import gc
import sys
import weakref
from collections.abc import Callable, Iterator
from types import ModuleType, SimpleNamespace
from typing import Any

import ipywidgets
import pytest
from marimo._plugins.ui._core.ids import IDProvider
from marimo._plugins.ui._impl.anywidget.init import init_marimo_widget
from marimo._runtime.cell_lifecycle_registry import CellLifecycleRegistry
from marimo._runtime.commands import (
    DeleteCellCommand,
    ExecuteCellCommand,
    UpdateCellConfigCommand,
)
from marimo._runtime.dataflow import DirectedGraph
from marimo._runtime.runtime import Kernel
from marimo._types.ids import CellId_t
from marimo_lens import LensError, Record

from tests.support.browser import BrowserLens
from tests.support.factories import png, record_lines, selection
from tests.support.kernel import FakeNotebook


@pytest.fixture
def creator(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> Iterator[Any]:
    notebook = FakeNotebook(
        monkeypatch,
        tmp_path / "notebook.py",
        {"creator": "lens = Lens()", "other": "other = Lens()", "data": "value = 1"},
    )
    registry = CellLifecycleRegistry()
    context = notebook.context
    context._kernel = SimpleNamespace(cell_metadata=dict.fromkeys(notebook.cells))
    context.cell_lifecycle_registry = registry
    context.stream = None
    context.virtual_files_supported = False
    context.virtual_file_registry = SimpleNamespace(
        refcount=lambda name: 0, remove=lambda file: None
    )
    monkeypatch.setattr(
        "marimo._plugins.ui._impl.anywidget.init.get_context", lambda: context
    )
    monkeypatch.setattr(
        "marimo._plugins.ui._impl.comm.broadcast_notification", lambda *a, **kw: None
    )
    monkeypatch.setattr(
        ipywidgets.Widget, "_widget_construction_callback", init_marimo_widget
    )
    # Inline assets isolate lifecycle ownership from anywidget file watchers.
    monkeypatch.setattr(BrowserLens, "_esm", str(BrowserLens._esm))
    monkeypatch.setattr(BrowserLens, "_css", str(BrowserLens._css))
    lenses = []

    def running(cell_id: str = "creator") -> None:
        context._kernel.cell_metadata.setdefault(cell_id, None)
        context.cell_id = cell_id
        context.execution_context = SimpleNamespace(cell_id=cell_id)
        context.take_id = IDProvider(cell_id).take_id

    def make(**kwargs: Any) -> BrowserLens:
        lens = BrowserLens(**kwargs)
        lenses.append(lens)
        return lens

    running()
    yield SimpleNamespace(
        notebook=notebook,
        registry=registry,
        running=running,
        make=make,
        context=context,
        lenses=lenses,
    )
    for lens in lenses:
        lens.close()
    for cell_id in tuple(registry.registry):
        context._kernel.cell_metadata.pop(cell_id, None)
        registry.dispose(cell_id, deletion=True)


@pytest.fixture
def native_mutation(creator: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    # Keep native compilation, graph mutation, metadata, and disposal ordering.
    # Variable deletion and notifications have no consumers in this test kernel.
    kernel: Any = object.__new__(Kernel)
    kernel._module = ModuleType("lens_lifecycle_test")
    kernel.globals.update(creator.context.globals)
    kernel.graph = DirectedGraph()
    kernel.cell_metadata = {}
    kernel._uninstantiated_execution_requests = {}
    kernel.errors = {}
    kernel.reactive_execution_mode = "autorun"
    kernel.module_registry = SimpleNamespace(
        missing_modules=lambda: set(), modules=lambda: set()
    )
    kernel.packages_callbacks = SimpleNamespace(
        should_update_script_metadata=lambda: False
    )
    kernel.autoreload_manager = SimpleNamespace(
        flag_if_imports_stale=lambda cell: None, forget_cell=lambda cell_id: None
    )
    kernel._delete_variables = lambda *args: None
    creator.context._kernel = kernel
    creator.context.graph = kernel.graph
    creator.context.globals = kernel.globals
    creator.context.is_embedded = lambda: True
    monkeypatch.setattr("marimo._runtime.runtime.get_context", lambda: creator.context)
    monkeypatch.setattr("marimo._runtime.runtime.get_mode", lambda: "edit")
    monkeypatch.setattr(
        "marimo._runtime.runtime.broadcast_notification", lambda *a: None
    )
    monkeypatch.setattr(
        "marimo._runtime.runtime.CellNotificationUtils.broadcast_stale",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "marimo._runtime.runtime.CellNotificationUtils.broadcast_error",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "marimo._runtime.runtime.CellNotificationUtils.broadcast_output",
        lambda **kwargs: None,
    )

    def mutate(codes: dict[str, str], deleted: tuple[str, ...] = ()) -> None:
        kernel.mutate_graph(
            execution_requests=[
                ExecuteCellCommand(cell_id=CellId_t(cell_id), code=code)
                for cell_id, code in codes.items()
            ],
            deletion_requests=[
                DeleteCellCommand(cell_id=CellId_t(cell_id)) for cell_id in deleted
            ],
        )

    mutate({"data": "value = 1", "creator": "lens = Lens(value)"})
    return mutate


@pytest.mark.parametrize("edited_cell", ["creator", "data"])
def test_native_code_edit_preserves_selection_and_request_baseline(
    creator: Any, native_mutation: Any, edited_cell: str
) -> None:
    first = creator.make(record=True)
    first.put(selection(note="Keep this evidence", output_cell_id="data"))
    chat = first.open_request("Check the edit")
    before = first.synced_state()
    old_comm = first.comm

    native_mutation(
        {
            edited_cell: "lens = Lens(value)\n# edited"
            if edited_cell == "creator"
            else "value = 2"
        }
    )
    creator.running()
    replacement = creator.make(record=True)

    assert replacement.synced_state() == before
    assert replacement.comm is not old_comm
    assert replacement._lens_id != first._lens_id
    with pytest.raises(LensError, match="closed"):
        first.context()
    replacement.resolve(["selection-1", chat], expected_revision=1)
    lines = record_lines(creator.notebook.filename)
    assert [line["concurrent"] for line in lines] == [[chat], ["selection-1"]]
    codes = {code["hash"]: code["text"] for code in lines[0]["codes"]}
    change = next(
        change for change in lines[0]["changes"] if change["cellId"] == edited_cell
    )
    assert codes[change["before"]] == (
        "lens = Lens(value)" if edited_cell == "creator" else "value = 1"
    )
    assert codes[change["after"]] == (
        "lens = Lens(value)\n# edited" if edited_cell == "creator" else "value = 2"
    )


def test_creator_rerun_that_adds_a_record_records_the_open_selection(
    creator: Any, native_mutation: Any
) -> None:
    first = creator.make()
    first.put(selection(note="Keep this evidence", output_cell_id="data"))
    before = first.synced_state()

    native_mutation({"creator": "lens = Lens(value, record=True)"})
    creator.running()
    replacement = creator.make(record=True)

    assert first.record is None
    assert replacement.record == Record()
    assert replacement.synced_state() == before
    replacement.resolve("selection-1", expected_revision=1)
    [line] = record_lines(creator.notebook.filename)
    assert (line["id"], line["label"], line["note"]) == (
        "selection-1",
        "S1",
        "Keep this evidence",
    )
    codes = {code["hash"]: code["text"] for code in line["codes"]}
    [change] = [change for change in line["changes"] if change["cellId"] == "creator"]
    assert codes[change["before"]] == "lens = Lens(value)"
    assert codes[change["after"]] == "lens = Lens(value, record=True)"


@pytest.mark.parametrize(
    "code",
    ["lens = Lens(", "lens = Lens(value)\nvalue = 3"],
    ids=["syntax", "semantic"],
)
def test_native_error_recovery_preserves_selection(
    creator: Any, native_mutation: Any, code: str
) -> None:
    first = creator.make()
    first.put(selection())
    before = first.synced_state()
    native_mutation({"creator": code})
    native_mutation({"data": "value = 2"})
    native_mutation({"creator": "lens = Lens(value)"})
    creator.running()
    replacement = creator.make()
    assert replacement.synced_state() == before
    replacement.resolve("selection-1", expected_revision=1)


def test_native_cell_configuration_preserves_selection(
    creator: Any, native_mutation: Any
) -> None:
    first = creator.make()
    first.put(selection())
    before = first.synced_state()
    asyncio.run(
        creator.context._kernel.set_cell_config(
            UpdateCellConfigCommand(configs={CellId_t("creator"): {"hide_code": True}})
        )
    )
    native_mutation({"creator": "lens = Lens(value)\n# edited"})
    creator.running()
    assert creator.make().synced_state() == before


def test_native_upstream_deletion_preserves_descendant_selection(
    creator: Any, native_mutation: Any
) -> None:
    first = creator.make()
    first.put(selection())
    native_mutation({}, deleted=("data",))
    native_mutation({"data": "value = 2"})
    creator.running()
    replacement = creator.make()
    assert replacement.context().current["id"] == "selection-1"


def test_creator_rerun_preserves_selections_and_original_request_baseline(
    creator: Any,
) -> None:
    first = creator.make(record=True)
    data = png()
    first.put(selection(note="Keep this evidence", output_cell_id="data"), image=data)
    first.put(selection(selection_id="selection-2", label="S2", output_cell_id="data"))
    first.command(
        "selection.activate", {"selectionId": "selection-1", "expectedRevision": 2}
    )
    chat = first.open_request("Check the original value")
    before = first.synced_state()
    old_comm, old_id = first.comm, first._lens_id
    creator.notebook.set("data", "value = 2")

    creator.registry.dispose("creator", deletion=False)
    creator.running()
    replacement = creator.make(record=True, displayed=False)

    assert replacement.synced_state() == before
    assert replacement._lens_id != old_id
    assert replacement.comm is not old_comm
    assert replacement._session.image("selection-1").data == data
    with pytest.raises(LensError) as closed:
        first.context()
    assert closed.value.code == "lens_closed"
    with pytest.raises(LensError) as unready:
        replacement._cell_image("data", expected_revision=3)
    assert unready.value.code == "browser_unavailable"
    replacement.resolve(["selection-1", chat], expected_revision=3)
    lines = record_lines(creator.notebook.filename)
    assert [(line["id"], line["concurrent"]) for line in lines] == [
        ("selection-1", [chat, "selection-2"]),
        (chat, ["selection-1", "selection-2"]),
    ]
    codes = {code["hash"]: code["text"] for code in lines[0]["codes"]}
    assert codes[lines[0]["changes"][0]["before"]] == "value = 1"
    assert codes[lines[0]["changes"][0]["after"]] == "value = 2"
    assert replacement.context().current["id"] == "selection-2"


def test_rerun_matches_construction_slots_and_cells(creator: Any) -> None:
    first, second = creator.make(), creator.make()
    first.put(selection(selection_id="first"))
    second.put(selection(selection_id="second", label="S2"))
    creator.running("other")
    other = creator.make()
    other.put(selection(selection_id="other", label="S3"))
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    adopted_first, adopted_second = creator.make(), creator.make()
    assert adopted_first.context().current["id"] == "first"
    assert adopted_second.context().current["id"] == "second"
    assert other.context().current["id"] == "other"
    adopted_first.put(selection(selection_id="next", label="S4"))
    assert adopted_first.context().current["label"] == "S4"


def test_late_old_disposal_cannot_release_adopted_requests(creator: Any) -> None:
    first = creator.make(record=True)
    first.put(selection())
    items = tuple(creator.registry.registry["creator"])
    comm = first.comm
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    replacement = creator.make(record=True)
    creator.context._kernel.cell_metadata.pop("creator")
    for item in items:
        item.dispose(creator.context, deletion=True)
    first.close()
    comm.close()
    replacement.resolve("selection-1", expected_revision=1)
    assert replacement.context().history()[0]["id"] == "selection-1"


def test_rerun_closes_transient_captures_and_watches(creator: Any) -> None:
    first = creator.make()
    first.put(selection())
    assert first._cell_image("data", expected_revision=1) is None
    first.reveal("data", duration_ms=None)
    assert creator.registry.registry["data"]
    creator.registry.dispose("creator", deletion=False)
    assert not creator.registry.registry.get("data")
    with pytest.raises(LensError) as closed:
        first._cell_image("data", expected_revision=1)
    assert closed.value.code == "lens_closed"
    creator.running()
    replacement = creator.make()
    assert replacement._cell_image("data", expected_revision=1) is None


def test_cleanup_tracker_releases_the_old_widget(creator: Any) -> None:
    first = creator.make()
    first.put(selection())
    reference = weakref.ref(first)
    creator.registry.dispose("creator", deletion=False)
    # The fixture holds widgets for teardown, so remove this closed widget.
    creator.lenses.remove(first)
    del first
    gc.collect()
    assert reference() is None
    creator.running()
    assert creator.make().context().current["id"] == "selection-1"


def test_activation_order_survives_creator_rerun(creator: Any) -> None:
    first = creator.make()
    for index in range(1, 4):
        first.put(selection(selection_id=f"selection-{index}", label=f"S{index}"))
    first.command(
        "selection.activate", {"selectionId": "selection-1", "expectedRevision": 3}
    )
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    replacement = creator.make()
    replacement.command(
        "selection.delete", {"selectionId": "selection-1", "expectedRevision": 4}
    )
    assert replacement.context().current["id"] == "selection-3"
    replacement.command(
        "selection.delete", {"selectionId": "selection-3", "expectedRevision": 5}
    )
    assert replacement.context().current["id"] == "selection-2"


def test_same_slot_in_another_kernel_starts_empty(creator: Any) -> None:
    first = creator.make()
    first.put(selection())
    creator.registry.dispose("creator", deletion=False)
    scope = creator.context.ui_element_registry
    creator.context.ui_element_registry = type(scope)()
    creator.running()
    other_kernel = creator.make()
    assert other_kernel.context().current is None
    creator.context.ui_element_registry = scope
    creator.running()
    assert creator.make().context().current["id"] == "selection-1"


def test_late_cleanup_cannot_discard_the_next_detached_generation(creator: Any) -> None:
    first = creator.make()
    first.put(selection())
    old_items = tuple(creator.registry.registry["creator"])
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    creator.make()
    creator.registry.dispose("creator", deletion=False)
    creator.context._kernel.cell_metadata.pop("creator")
    for item in old_items:
        item.dispose(creator.context, deletion=True)
    creator.running()
    assert creator.make().context().current["id"] == "selection-1"


def test_retention_bounds_release_the_oldest_request_owner(creator: Any) -> None:
    for index in range(65):
        lens = creator.make()
        lens.put(selection(selection_id=f"selection-{index}", label=f"S{index + 1}"))
    creator.registry.dispose("creator", deletion=False)
    runtime = creator.lenses[0]._session._runtime
    remaining = [
        index for index in range(65) if runtime.requests.get(f"selection-{index}")
    ]
    assert len(remaining) == 64
    evicted = next(index for index in range(65) if index not in remaining)
    creator.running()
    replacements = [creator.make() for _ in range(65)]
    assert replacements[evicted].context().current is None
    for index in remaining:
        assert replacements[index].context().current["id"] == f"selection-{index}"


def test_retention_bounds_distinct_baseline_source_and_releases_whole_owners(
    creator: Any,
) -> None:
    for index in range(33):
        creator.running(f"budget-{index}")
        creator.notebook.set(
            "data", "text = " + repr(str(index) + "x" * (2 * 1024 * 1024))
        )
        lens = creator.make()
        for offset in range(2):
            lens.put(
                selection(
                    selection_id=f"selection-{index}-{offset}",
                    label=f"S{2 * index + offset + 1}",
                )
            )
        creator.registry.dispose(f"budget-{index}", deletion=False)

    runtime = creator.lenses[0]._session._runtime
    for index in range(33):
        creator.running(f"budget-{index}")
        replacement = creator.make()
        if index < 2:
            assert replacement.context().current is None
            assert runtime.requests.get(f"selection-{index}-0") is None
            assert runtime.requests.get(f"selection-{index}-1") is None
        else:
            assert [
                item["id"] for item in replacement.synced_state()["selections"]
            ] == [f"selection-{index}-0", f"selection-{index}-1"]


def test_retention_shares_source_accounting_across_baselines(creator: Any) -> None:
    creator.notebook.set("data", "text = " + repr("x" * (2 * 1024 * 1024)))
    for index in range(33):
        creator.running(f"budget-{index}")
        lens = creator.make()
        lens.put(selection(selection_id=f"selection-{index}", label=f"S{index + 1}"))
        creator.registry.dispose(f"budget-{index}", deletion=False)

    for index in range(33):
        creator.running(f"budget-{index}")
        assert creator.make().context().current["id"] == f"selection-{index}"


def test_retention_bounds_total_image_bytes(
    creator: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = png()
    monkeypatch.setattr(
        "marimo_lens._session.runtime.MAX_RETAINED_BYTES",
        sum(sys.getsizeof(cell.code) for cell in creator.notebook.cells.values())
        + 2 * len(data),
    )
    lenses = [creator.make() for _ in range(3)]
    for index, lens in enumerate(lenses):
        lens.put(
            selection(selection_id=f"selection-{index}", label=f"S{index + 1}"),
            image=data,
        )
    creator.registry.dispose("creator", deletion=False)
    runtime = lenses[0]._session._runtime
    assert (
        sum(
            runtime.requests.get(f"selection-{index}") is not None for index in range(3)
        )
        == 2
    )
    creator.running()
    replacements = [creator.make() for _ in range(3)]
    images = [lens._session.state.image_bytes for lens in replacements]
    assert sorted(images) == [0, len(data), len(data)]


@pytest.mark.parametrize("ending", ["selection.delete", "selections.clear", "resolve"])
def test_empty_selection_revision_survives_creator_rerun(
    creator: Any, ending: str
) -> None:
    first = creator.make()
    first.put(selection())
    if ending == "resolve":
        first.resolve("selection-1", expected_revision=1)
    else:
        payload: dict[str, Any] = {"expectedRevision": 1}
        if ending == "selection.delete":
            payload["selectionId"] = "selection-1"
        first.command(ending, payload)
    before = first.synced_state()
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    assert creator.make(displayed=False).synced_state() == before
    assert first._session._runtime.requests.get("selection-1") is None


def test_requests_opened_during_handoff_keep_selection_overlap(creator: Any) -> None:
    first = creator.make(record=True)
    first.put(selection(output_cell_id="data"))
    creator.running("other")
    other = creator.make()
    creator.registry.dispose("creator", deletion=False)
    chat = other.open_request("Check the outstanding selection")
    creator.notebook.set("data", "value = 3")
    creator.running()
    replacement = creator.make(record=True)
    replacement.resolve(["selection-1", chat], expected_revision=1)
    lines = record_lines(creator.notebook.filename)
    assert [line["concurrent"] for line in lines] == [[chat], ["selection-1"]]
    codes = {code["hash"]: code["text"] for code in lines[0]["codes"]}
    assert codes[lines[0]["changes"][0]["before"]] == "value = 1"


def test_repeated_descendant_invalidations_preserve_the_handoff(creator: Any) -> None:
    first = creator.make()
    first.put(selection())
    creator.registry.dispose("creator", deletion=False)
    creator.registry.dispose("creator", deletion=False)
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    replacement = creator.make()
    assert replacement.context().current["id"] == "selection-1"
    replacement.resolve("selection-1", expected_revision=1)


def _errored_then_deleted(code: str) -> Callable[[Any, Any], Any]:
    def replace(creator: Any, request: Any) -> Any:
        mutate = request.getfixturevalue("native_mutation")
        creator.make().put(selection())
        mutate({"creator": code})
        mutate({}, deleted=("creator",))
        mutate({"replacement": "lens = Lens(value)"})
        creator.running("replacement")
        return creator.make(record=True)

    return replace


def _deleted_natively(creator: Any, request: Any, *, detach: bool = False) -> Any:
    mutate = request.getfixturevalue("native_mutation")
    creator.make().put(selection())
    if detach:
        mutate({"data": "value = 2"})
    mutate({}, deleted=("creator",))
    mutate({"creator": "lens = Lens(value)"})
    creator.running()
    return creator.make(record=True)


def _ended(creator: Any, request: Any, end: Callable[[Any], None]) -> Any:
    first = creator.make()
    first.put(selection())
    end(first)
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    return creator.make(record=True)


def _deleted(creator: Any) -> None:
    creator.context._kernel.cell_metadata.pop("creator")
    creator.registry.dispose("creator", deletion=True)


def _detached_then_deleted(creator: Any, request: Any) -> Any:
    creator.make().put(selection())
    creator.registry.dispose("creator", deletion=False)
    _deleted(creator)
    creator.running()
    return creator.make(record=True)


def _changed_selector(creator: Any, request: Any) -> Any:
    creator.make(dom_selector="main").put(selection())
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    return creator.make(record=True, dom_selector="#changed")


def _unrecognized_comm(creator: Any, request: Any) -> Any:
    monkeypatch = request.getfixturevalue("monkeypatch")
    monkeypatch.setattr(ipywidgets.Widget, "_widget_construction_callback", None)
    first = creator.make()
    first.put(selection())
    first.comm.close()
    creator.running()
    return creator.make(record=True)


def _baseline_over_budget(creator: Any, request: Any) -> Any:
    monkeypatch = request.getfixturevalue("monkeypatch")
    monkeypatch.setattr("marimo_lens._session.runtime.MAX_RETAINED_BYTES", 1024)
    creator.notebook.set("data", "text = " + repr("x" * 2048))
    creator.make().put(selection())
    creator.registry.dispose("creator", deletion=False)
    creator.running()
    return creator.make(record=True)


@pytest.mark.parametrize(
    "replace",
    [
        pytest.param(_deleted_natively, id="native-deletion"),
        pytest.param(
            lambda creator, request: _deleted_natively(creator, request, detach=True),
            id="native-deletion-after-detaching",
        ),
        pytest.param(
            lambda creator, request: _ended(
                creator, request, lambda lens: lens.close()
            ),
            id="close",
        ),
        pytest.param(
            lambda creator, request: _ended(
                creator, request, lambda lens: lens.comm.close()
            ),
            id="comm-close",
        ),
        pytest.param(
            lambda creator, request: _ended(
                creator, request, lambda lens: _deleted(creator)
            ),
            id="cell-deletion",
        ),
        pytest.param(_detached_then_deleted, id="cell-deletion-after-detaching"),
        pytest.param(_changed_selector, id="changed-selector"),
        pytest.param(_unrecognized_comm, id="unrecognized-comm-lifecycle"),
        pytest.param(_baseline_over_budget, id="baseline-over-the-retention-budget"),
        pytest.param(_errored_then_deleted("lens = Lens("), id="syntax-error-deletion"),
        pytest.param(
            _errored_then_deleted("lens = Lens(value)\nvalue = 3"),
            id="redefinition-error-deletion",
        ),
    ],
)
def test_a_released_lens_leaves_its_replacement_empty(
    creator: Any, request: Any, replace: Callable[[Any, Any], Any]
) -> None:
    replacement = replace(creator, request)

    assert replacement.context().current is None
    # A selection request still held for the old Lens would be concurrent with this one.
    chat = replacement.open_request("Check the replacement")
    replacement.resolve(chat, expected_revision=replacement.revision)
    assert replacement.context().history()[-1]["concurrent"] == []
