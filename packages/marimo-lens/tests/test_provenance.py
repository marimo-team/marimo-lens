from __future__ import annotations

from marimo_lens._provenance import resolve_provenance

from tests.support.factories import cell, snapshot


def test_provenance_keeps_topological_order_and_dag_roles() -> None:
    runtime = snapshot(
        cell("cell-source", code="source = load()", defs=("source",)),
        cell(
            "cell-data-a",
            code="data = clean(source)",
            defs=("data",),
            refs=("source",),
            upstream=("cell-source",),
        ),
        cell(
            "cell-data-b",
            code="data = fallback(source)",
            defs=("data",),
            refs=("source",),
            upstream=("cell-source",),
        ),
        cell(
            "cell-view",
            code="data",
            refs=("data",),
            upstream=("cell-data-a", "cell-data-b"),
        ),
    )

    provenance = resolve_provenance(runtime, ["cell-view"])

    assert [item.cell.id for item in provenance.cells] == [
        "cell-source",
        "cell-data-a",
        "cell-data-b",
        "cell-view",
    ]
    roles = {item.cell.id: item.roles for item in provenance.cells}
    assert roles["cell-view"] == ("selected-output",)
    assert roles["cell-data-a"] == ("upstream",)
    assert roles["cell-source"] == ("upstream",)
    assert provenance.referenced_names == frozenset({"data", "source"})


def test_provenance_prioritizes_selected_cell_and_reports_limits() -> None:
    runtime = snapshot(
        cell("cell-root", code="r" * 10),
        cell("cell-parent", code="p" * 10, upstream=("cell-root",)),
        cell(
            "cell-view",
            code="v" * 10,
            upstream=("cell-parent",),
        ),
    )

    provenance = resolve_provenance(
        runtime,
        ["cell-view"],
        max_cells=2,
        max_source_characters=12,
    )

    assert {item.cell.id for item in provenance.cells} == {
        "cell-view",
        "cell-parent",
    }
    assert provenance.omitted_cell_ids == ("cell-root",)
    assert provenance.truncated_cell_ids == ("cell-parent",)
    by_id = {item.cell.id: item.code for item in provenance.cells}
    assert by_id["cell-view"] == "v" * 10
    assert by_id["cell-parent"] == "p" * 2


def test_provenance_keeps_every_supported_selected_output() -> None:
    cells = tuple(cell(f"cell-{index}", code=str(index)) for index in range(64))
    output_ids = [item.id for item in cells]

    provenance = resolve_provenance(snapshot(*cells), output_ids)

    assert {item.cell.id for item in provenance.cells} == set(output_ids)
    assert provenance.omitted_cell_ids == ()


def test_provenance_bounds_reported_omissions_and_keeps_full_relevance() -> None:
    cells = tuple(
        cell(
            f"cell-{index}",
            code=str(index),
            refs=(f"value-{index}",),
            upstream=(f"cell-{index - 1}",) if index else (),
        )
        for index in range(1_000)
    )

    provenance = resolve_provenance(
        snapshot(*cells),
        ["cell-999"],
        max_cells=1,
    )

    assert len(provenance.omitted_cell_ids) == 16
    assert provenance.omitted_cell_count == 999
    assert len(provenance.referenced_names) == 1_000
    assert "value-0" in provenance.referenced_names
