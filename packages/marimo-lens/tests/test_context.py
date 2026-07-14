from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from marimo_lens import Lens
from marimo_lens import context
import marimo_lens.context as context_module
from marimo_lens.context import collect_notebook_graph, collect_runtime_context

from tests.support.sample_entities import (
    FrameLike,
    SecretTraitThing,
    SecretWidget,
    TraitThing,
)
from tests.support.runtime_contexts import _cell, _install_context, _runtime_context


def test_collect_notebook_graph_summarizes_whole_runtime_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike(), "threshold": 10})
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    global_names = {item["name"] for item in snapshot["globals"]}

    assert snapshot["available"] is True
    assert snapshot["filename"] == "demo.py"
    assert snapshot["definitions"] == {
        "sales": ["cell-data"],
        "threshold": ["cell-config"],
        "view": ["cell-view"],
    }
    assert snapshot["runtime"]["argv"] == ["demo.py"]
    assert {"sales", "threshold"}.issubset(global_names)
    assert len(snapshot["cells"]) == 3


def test_collect_notebook_graph_preserves_runtime_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(
        globals={"sales": FrameLike()},
        query_params={"tab": "review", "api_token": "secret-token"},
        argv=[
            "demo.py",
            "--api-key=secret-token",
            "--token",
            "split-secret",
            "--region",
            "north",
        ],
    )
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()

    assert snapshot["runtime"]["queryParams"]["tab"] == "review"
    assert snapshot["runtime"]["queryParams"]["api_token"] == "secret-token"
    assert snapshot["runtime"]["argv"] == [
        "demo.py",
        "--api-key=secret-token",
        "--token",
        "split-secret",
        "--region",
        "north",
    ]
    serialized = json.dumps(snapshot)
    assert "secret-token" in serialized
    assert "split-secret" in serialized


def test_collect_notebook_graph_accepts_marimo_query_params(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from marimo._runtime.params import QueryParams

    ctx = _runtime_context(
        globals={"sales": FrameLike()},
        query_params=QueryParams(
            {
                "tab": "review",
                "api_token": "secret-token",
                "tag": ["lineage", "feedback"],
            }
        ),
    )
    _install_context(monkeypatch, ctx)

    lens = Lens()
    query_params = lens.notebook["runtime"]["queryParams"]

    assert query_params == {
        "tab": "review",
        "api_token": "secret-token",
        "tag": ["lineage", "feedback"],
    }
    assert "secret-token" in lens.export_pair_json()


def test_collect_notebook_graph_handles_repeated_query_string_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(
        globals={"sales": FrameLike()},
        query_params="?tag=lineage&tag=feedback&empty=",
    )
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()

    assert snapshot["runtime"]["queryParams"] == {
        "tag": ["lineage", "feedback"],
        "empty": "",
    }


def test_collect_notebook_graph_preserves_code_previews(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike()})
    ctx.graph.cells[
        "cell-data"
    ].code = 'api_token = "SECRET123"\nsales = pd.DataFrame(...)'
    _install_context(monkeypatch, ctx)

    lens = Lens()
    serialized = lens.export_pair_json()

    assert "SECRET123" in serialized
    assert lens.notebook["cells"][0]["codePreview"].startswith(
        'api_token = "SECRET123"'
    )


def test_collect_notebook_graph_reports_unavailable_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        context_module,
        "_runtime_context",
        lambda: (None, "not running in a marimo kernel"),
    )

    snapshot = collect_notebook_graph(namespace={"sales": FrameLike()})

    assert snapshot["available"] is False
    assert snapshot["reason"] == "not running in a marimo kernel"
    assert snapshot["globals"][0]["name"] == "sales"


def test_collect_notebook_graph_reports_missing_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = SimpleNamespace(graph=None, globals={"sales": FrameLike()})
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()

    assert snapshot["available"] is False
    assert snapshot["reason"] == "runtime context has no graph"
    assert snapshot["globals"][0]["name"] == "sales"


def test_collect_notebook_graph_output_refs_are_cycle_safe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sales = FrameLike()
    output: dict[str, Any] = {"sales": sales}
    output["cycle"] = output
    ctx = _runtime_context(globals={"sales": sales})
    ctx.graph.cells["cell-view"].output = output
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    view_cell = next(cell for cell in snapshot["cells"] if cell["id"] == "cell-view")

    assert view_cell["outputRefs"] == ["sales"]


def test_collect_notebook_graph_does_not_infer_scalar_output_refs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    threshold = 10
    impedance = 1 + 2j
    ctx = _runtime_context(
        globals={"threshold": threshold, "status": "ok", "impedance": impedance}
    )
    ctx.graph.cells["cell-view"].output = impedance
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    view_cell = next(cell for cell in snapshot["cells"] if cell["id"] == "cell-view")

    assert view_cell["outputRefs"] == []


def test_collect_runtime_context_sniffs_ui_and_traitlets_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    limit = mo.ui.slider(0, 10, value=3, label="Limit")
    choice = mo.ui.dropdown(["north", "south"], value="south", label="Region")
    traits = TraitThing()
    ctx = _runtime_context(
        globals={
            "limit": limit,
            "choice": choice,
            "traits": traits,
            "sales": FrameLike(),
        }
    )
    ctx.graph.definitions["limit"] = {"cell-controls"}
    ctx.graph.definitions["choice"] = {"cell-controls"}
    ctx.graph.definitions["traits"] = {"cell-controls"}
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    direct = collect_runtime_context(ctx.globals, definitions=ctx.graph.definitions)
    controls = snapshot["controls"]
    ui_by_name = {item["name"]: item for item in controls["uiElements"]}
    trait_by_name = {item["name"]: item for item in controls["traitletsObjects"]}

    assert controls["summary"]["uiElementCount"] == 2
    assert direct["summary"]["uiElementCount"] == 2
    assert controls["summary"]["traitletsObjectCount"] == 1
    assert ui_by_name["limit"]["component"] == "marimo-slider"
    assert ui_by_name["limit"]["value"] == 3
    assert ui_by_name["limit"]["args"]["start"] == 0
    assert ui_by_name["choice"]["value"] == "south"
    assert trait_by_name["traits"]["state"]["enabled"] is True


def test_collect_runtime_context_preserves_trait_and_widget_state() -> None:
    snapshot = collect_runtime_context(
        {
            "traits": SecretTraitThing(),
            "widget": SecretWidget(),
        }
    )
    trait_state = snapshot["traitletsObjects"][0]["state"]
    widget_state = snapshot["widgets"][0]["state"]

    assert trait_state["api_token"] == "trait-secret"
    assert trait_state["public"] == "visible"
    assert widget_state["api_token"] == "widget-secret"
    assert widget_state["public"] == "visible"


def test_collect_runtime_context_keeps_plain_text_and_password_controls() -> None:
    import marimo as mo

    search = mo.ui.text(value="north", kind="text", label="Region")
    password = mo.ui.text(value="secret-value", kind="password", label="Password")
    snapshot = collect_runtime_context({"search": search, "password": password})
    ui_by_name = {item["name"]: item for item in snapshot["uiElements"]}

    assert ui_by_name["search"]["value"] == "north"
    assert ui_by_name["search"]["initialValue"] == "north"
    assert ui_by_name["search"]["args"]["kind"] == "text"
    assert ui_by_name["password"]["value"] == "secret-value"
    assert ui_by_name["password"]["initialValue"] == "secret-value"
    assert ui_by_name["password"]["args"]["kind"] == "password"


def test_wrapped_anywidget_state_is_available_in_targets_and_controls() -> None:
    import marimo as mo

    wrapped = mo.ui.anywidget(SecretWidget(api_token="widget-secret"))
    lens = Lens(source=context.mapping({"wrapped": wrapped}))
    runtime = collect_runtime_context({"wrapped": wrapped})
    serialized = json.dumps(
        {
            "targets": lens.targets,
            "notebook": lens.notebook,
            "runtime": runtime,
            "pair_feedback": lens.pair_feedback,
        },
        sort_keys=True,
    )

    assert "widget-secret" in serialized
    assert "<redacted>" not in serialized


def test_collect_runtime_context_caps_errors_and_reports_total_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        context_module,
        "_is_marimo_ui_element",
        lambda _value: (_ for _ in ()).throw(RuntimeError("bad control")),
    )
    namespace = {f"control_{index}": object() for index in range(85)}

    snapshot = collect_runtime_context(namespace)

    assert snapshot["summary"]["errorCount"] == 85
    assert snapshot["summary"]["capturedErrorCount"] == 80
    assert len(snapshot["errors"]) == 80
    assert snapshot["errors"][0]["error"] == "RuntimeError: bad control"


def test_collect_notebook_graph_records_output_refs_from_runtime_outputs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sales = FrameLike()
    ctx = _runtime_context(globals={"sales": sales}, display_sales=True)
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    view_cell = next(cell for cell in snapshot["cells"] if cell["id"] == "cell-view")

    assert view_cell["outputRefs"] == ["sales"]


def test_collect_notebook_graph_records_output_expression_cells(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike()})
    ctx.graph.cells["cell-shape"] = _cell(
        defs=set(),
        refs={"sales"},
        code="sales.shape",
    )
    ctx.graph.cells["cell-shape"].last_expr = object()
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    shape_cell = next(cell for cell in snapshot["cells"] if cell["id"] == "cell-shape")

    assert shape_cell["hasOutputExpression"] is True
    assert shape_cell["outputType"] == ""


def test_collect_notebook_graph_uses_cell_status_and_disabled_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _runtime_context(globals={"sales": FrameLike()})
    ctx.graph.cells["cell-error"] = _cell(
        defs={"broken"},
        refs={"sales"},
        code="raise RuntimeError('boom')",
    )
    ctx.graph.cells["cell-error"].run_result_status = "error"
    ctx.graph.cells["cell-error"].stale = True
    ctx.graph.cells["cell-error"].config = SimpleNamespace(disabled=True)
    _install_context(monkeypatch, ctx)

    snapshot = collect_notebook_graph()
    error_cell = next(cell for cell in snapshot["cells"] if cell["id"] == "cell-error")

    assert error_cell["status"] == "error"
    assert error_cell["stale"] is True
    assert error_cell["disabled"] is True
