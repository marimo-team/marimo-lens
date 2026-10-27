from __future__ import annotations

import pathlib
from types import SimpleNamespace

import pytest
from marimo_lens import Lens
from marimo_lens._protocol.messages import PROTOCOL_VERSION


def test_exported_lens_renders_directly_in_marimo() -> None:
    from marimo._output.formatting import try_format

    lens = Lens()

    formatted = try_format(lens)

    assert formatted.mimetype == "text/html"
    assert "marimo-anywidget" in formatted.data
    lens.close()


def test_add_lens_cell_output_is_discoverable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo._runtime.context as context_module
    import marimo_lens
    from marimo._runtime import cell_output_list
    from marimo._runtime.output import _output as output_module
    from marimo_lens import agent

    execution_context = SimpleNamespace(
        cell_id="cell-import",
        output=cell_output_list.CellOutputList(),
    )

    class RuntimeScope:
        pass

    runtime = SimpleNamespace(
        execution_context=execution_context,
        ui_element_registry=RuntimeScope(),
    )
    created: list[Lens] = []
    notebook: list[SimpleNamespace] = []

    def create_lens() -> Lens:
        lens = Lens()
        created.append(lens)
        return lens

    class Cells:
        def find(self, substring: str) -> list[SimpleNamespace]:
            return [cell for cell in notebook if substring in cell.code]

    class Context:
        def __init__(self) -> None:
            self.code = ""
            self.hidden = False
            self.runs: list[str] = []
            self.cells = Cells()

        def create_cell(self, code: str, *, hide_code: bool) -> str:
            self.code = code
            self.hidden = hide_code
            notebook.append(SimpleNamespace(id="lens-cell", code=code, status="queued"))
            return "lens-cell"

        def run_cell(self, cell_id: str) -> None:
            self.runs.append(cell_id)

    context = Context()
    monkeypatch.setattr(output_module, "get_context", lambda: runtime)
    monkeypatch.setattr(
        output_module,
        "write_internal",
        lambda **_kwargs: None,
    )
    monkeypatch.setattr(marimo_lens, "Lens", create_lens)

    cell_id = agent.add_lens_cell(context)
    retry_context = Context()
    retry_cell_id = agent.add_lens_cell(retry_context)
    exec(context.code, {})  # noqa: S102 - execute the generated notebook cell

    assert cell_id == "lens-cell"
    assert retry_cell_id == cell_id
    assert context.hidden is True
    assert context.runs == ["lens-cell"]
    assert retry_context.runs == []
    assert len(notebook) == 1
    assert len(created) == 1
    output = execution_context.output.stack()
    assert output is not None
    assert "marimo-anywidget" in output.text

    monkeypatch.setattr(context_module, "get_context", lambda: runtime)
    lens = created[0]
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.event",
            "version": PROTOCOL_VERSION,
            "type": "output.capture.ready",
            "payload": {},
        },
        [],
    )
    assert agent.connect().identity
    lens.close()


def test_lens_loads_the_built_widget_assets() -> None:
    static_dir = pathlib.Path(__file__).parents[1] / "src" / "marimo_lens" / "static"
    lens = Lens()

    assert lens._esm == (static_dir / "widget.js").read_text(encoding="utf-8")
    assert lens._css == (static_dir / "widget.css").read_text(encoding="utf-8")
    lens.close()
