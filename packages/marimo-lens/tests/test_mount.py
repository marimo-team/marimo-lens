from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from marimo_lens import Lens, agent, automatic_lens, notebook_lens


class _RuntimeScope:
    pass


class _CellLifecycle:
    # Earlier marimo formatting installs its widget comm globally. Its comm then
    # registers resources here, which a cell-less context creates immediately.
    def add(self, item: Any) -> None:
        item.create(None)


@pytest.fixture(autouse=True)
def runtime(monkeypatch: pytest.MonkeyPatch) -> Iterator[SimpleNamespace]:
    import marimo._runtime.app_meta as app_meta_module
    import marimo._runtime.context as context_module

    cells: dict[str, SimpleNamespace] = {}
    context = SimpleNamespace(
        ui_element_registry=_RuntimeScope(),
        graph=SimpleNamespace(cells=cells),
        execution_context=SimpleNamespace(cell_id="imports"),
        cell_lifecycle_registry=_CellLifecycle(),
    )
    state = SimpleNamespace(mode="edit", cells=cells, context=context, lenses=[])
    monkeypatch.setattr(context_module, "get_context", lambda: context)
    monkeypatch.setattr(app_meta_module, "get_mode", lambda: state.mode)
    _notebook(state, "import marimo as mo")
    yield state
    for lens in state.lenses:
        lens.close()


def _notebook(runtime: SimpleNamespace, *codes: str) -> None:
    runtime.cells.clear()
    runtime.cells["imports"] = SimpleNamespace(code=codes[0])
    runtime.cells.update(
        (f"cell-{index}", SimpleNamespace(code=code))
        for index, code in enumerate(codes[1:], start=1)
    )


def _running(runtime: SimpleNamespace, cell_id: str) -> None:
    runtime.context.execution_context.cell_id = cell_id


def _lens(runtime: SimpleNamespace, lens: Lens | None) -> Lens | None:
    if lens is not None:
        runtime.lenses.append(lens)
    return lens


def test_editor_notebook_shows_one_automatic_lens(runtime: SimpleNamespace) -> None:
    first = _lens(runtime, automatic_lens())

    assert isinstance(first, Lens)
    assert notebook_lens() is first
    assert automatic_lens() is None

    first.close()
    replacement = _lens(runtime, automatic_lens())
    assert isinstance(replacement, Lens) and replacement is not first


@pytest.mark.parametrize(
    "code",
    [
        "from marimo_lens import Lens\nlens = Lens(dom_selector='main')",
        "import marimo_lens as ml\nml.Lens()",
        "import marimo as _mo\nfrom marimo_lens import Lens as _Lens\n_mo.output.append(_Lens())",
    ],
    ids=["authored", "module", "private"],
)
def test_notebook_that_creates_a_lens_skips_the_automatic_lens(
    runtime: SimpleNamespace, code: str
) -> None:
    _notebook(runtime, "import marimo as mo", code)

    assert _lens(runtime, automatic_lens()) is None


def test_agent_managed_lens_cell_skips_the_automatic_lens(
    runtime: SimpleNamespace,
) -> None:
    created: list[str] = []

    def create_cell(code: str, **_kwargs: object) -> str:
        created.append(code)
        return "lens-cell"

    agent.add_lens_cell(
        SimpleNamespace(
            cells=SimpleNamespace(find=lambda _marker: []),
            create_cell=create_cell,
            run_cell=lambda _cell_id: None,
        )
    )
    _notebook(runtime, "import marimo as mo", *created)

    assert _lens(runtime, automatic_lens()) is None


@pytest.mark.parametrize(
    "code",
    [
        "import marimo_lens.agent as _agent\n_agent.connect()",
        "from marimo_lens import LensContext",
        "import marimo_lens\nmarimo_lens.notebook_lens()",
        "note = 'marimo_lens Lens'",
    ],
    ids=["agent-module", "types", "host-api", "text"],
)
def test_other_lens_references_keep_the_automatic_lens(
    runtime: SimpleNamespace, code: str
) -> None:
    _notebook(runtime, "import marimo as mo", code)

    assert isinstance(_lens(runtime, automatic_lens()), Lens)


def test_lens_created_by_a_notebook_cell_replaces_the_automatic_lens(
    runtime: SimpleNamespace,
) -> None:
    _notebook(runtime, "import marimo as mo", "lens = make_lens()")
    automatic = _lens(runtime, automatic_lens())
    assert automatic is not None

    _running(runtime, "cell-1")
    authored = _lens(runtime, Lens(dom_selector="main"))

    assert automatic._lens_closed
    assert notebook_lens() is authored


def test_scratchpad_lens_work_leaves_the_notebook_lens_alone(
    runtime: SimpleNamespace,
) -> None:
    automatic = _lens(runtime, automatic_lens())
    assert automatic is not None

    _running(runtime, "__scratch__")
    assert automatic_lens() is None
    _lens(runtime, Lens())

    assert not automatic._lens_closed
    assert notebook_lens() is automatic


def test_scratchpad_gets_no_automatic_lens(runtime: SimpleNamespace) -> None:
    _running(runtime, "__scratch__")

    assert _lens(runtime, automatic_lens()) is None


@pytest.mark.parametrize("mode", ["run", "script", "test", None])
def test_automatic_lens_is_limited_to_the_editor(
    runtime: SimpleNamespace, mode: str | None
) -> None:
    runtime.mode = mode

    assert _lens(runtime, automatic_lens()) is None


def test_open_lens_suppresses_the_automatic_lens(runtime: SimpleNamespace) -> None:
    authored = _lens(runtime, Lens())

    assert automatic_lens() is None
    assert notebook_lens() is authored


def test_notebook_lens_returns_the_oldest_open_lens(runtime: SimpleNamespace) -> None:
    first, second = Lens(), Lens()
    runtime.lenses.extend((first, second))

    assert notebook_lens() is first
    first.close()
    assert notebook_lens() is second
    second.close()
    assert notebook_lens() is None


def test_notebook_lens_is_scoped_to_the_active_runtime(
    monkeypatch: pytest.MonkeyPatch, runtime: SimpleNamespace
) -> None:
    import marimo._runtime.context as context_module

    runtime.lenses.append(Lens())
    other = SimpleNamespace(ui_element_registry=_RuntimeScope(), graph=None)
    monkeypatch.setattr(context_module, "get_context", lambda: other)

    assert notebook_lens() is None
