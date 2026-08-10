from __future__ import annotations

import pathlib
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import pytest
from marimo_lens import Lens


class RecordingLens(Lens):
    sent: list[tuple[dict[str, Any], list[bytes]]]

    def __init__(self) -> None:
        self.sent = []
        super().__init__()

    def send(
        self,
        content: dict[str, Any],
        buffers: Sequence[bytes | bytearray | memoryview] | None = None,
    ) -> None:
        self.sent.append((content, [bytes(buffer) for buffer in buffers or []]))


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

    def create_lens() -> Lens:
        lens = Lens()
        created.append(lens)
        return lens

    class Context:
        def __init__(self) -> None:
            self.code = ""
            self.hidden = False
            self.runs: list[str] = []

        def create_cell(self, code: str, *, hide_code: bool) -> str:
            self.code = code
            self.hidden = hide_code
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
    exec(context.code, {})  # noqa: S102 - execute the generated notebook cell

    assert cell_id == "lens-cell"
    assert context.hidden is True
    assert context.runs == ["lens-cell"]
    assert len(created) == 1
    output = execution_context.output.stack()
    assert output is not None
    assert "marimo-anywidget" in output.text

    monkeypatch.setattr(context_module, "get_context", lambda: runtime)
    lens = created[0]
    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.event",
            "version": 2,
            "type": "output.capture.ready",
            "payload": {},
        },
        [],
    )
    assert agent.connect().identity
    lens.close()


def test_lens_loads_esbuild_assets_and_handles_lens_messages() -> None:
    static_dir = pathlib.Path(__file__).parents[1] / "src" / "marimo_lens" / "static"
    widget_source = (static_dir / "widget.js").read_text(encoding="utf-8")
    widget_css = (static_dir / "widget.css").read_text(encoding="utf-8")
    lens = RecordingLens()

    lens._handle_custom_msg(
        {
            "protocol": "marimo-lens.command",
            "version": 2,
            "requestId": "clear-request",
            "type": "selections.clear",
            "payload": {"expectedRevision": 0},
        },
        [],
    )

    assert lens._esm == widget_source
    assert lens._css == widget_css
    assert len(lens.sent) == 1
    lens_response, lens_buffers = lens.sent[0]
    assert lens_response["protocol"] == "marimo-lens.response"
    assert lens_response["requestId"] == "clear-request"
    assert lens_response["ok"] is True
    assert lens_response["payload"] == {}
    assert lens_buffers == []
    lens.close()
