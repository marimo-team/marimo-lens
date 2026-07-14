from __future__ import annotations

import json
from typing import Any

import pytest

from marimo_lens import Lens, context, selection, targets


@pytest.mark.parametrize(
    ("target", "match"),
    [
        ({"label": "partial", "kind": "object"}, "id"),
        ({"id": "custom:partial", "kind": "object"}, "label"),
        (
            {"id": "custom:invalid", "label": "invalid", "kind": "unsupported"},
            "kind",
        ),
        (
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "capabilities": {"sortable": True},
            },
            "unknown keys",
        ),
        (
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "oldApi": True,
            },
            "unknown keys",
        ),
        (
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "columns": ["amount"],
            },
            "column 0 must be a mapping",
        ),
        (
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "selectionPolicy": {"prefer": ["magic"]},
            },
            "unknown surfaces",
        ),
        (
            {
                "id": "custom:chart",
                "label": "chart",
                "kind": "visualization",
                "chart": {"parts": [{"kind": "tooltip", "label": "tip"}]},
            },
            "chart part kind",
        ),
        (
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "selectionModel": {"units": [{"id": "broken"}]},
            },
            "requires kind",
        ),
    ],
)
def test_lens_validates_manual_target_contract(
    target: dict[str, Any],
    match: str,
) -> None:
    with pytest.raises(ValueError, match=match):
        Lens(targets=[target], source=context.mapping({}))


def test_lens_requires_manual_targets_to_be_mappings() -> None:
    invalid_target: Any = object()

    with pytest.raises(ValueError, match="must be a mapping"):
        Lens(targets=[invalid_target], source=context.mapping({}))


def test_lens_preserves_manual_target_context_values() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "selectionPolicy": {
                    "context": {
                        "api_token": "manual-secret",
                        "nested": {"Authorization": "Bearer manual-bearer"},
                    }
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets
    serialized = json.dumps(target, sort_keys=True)

    assert target["selectionPolicy"]["context"]["api_token"] == "manual-secret"
    assert "manual-bearer" in serialized


def test_lens_serializes_typed_manual_target_builders() -> None:
    lens = Lens(
        targets=[
            targets.dataframe(
                id="custom:orders",
                label="Orders",
                selector="[data-orders-grid]",
                columns=[targets.Column("amount", "float")],
                selection=selection.Policy.prefer(
                    "columnar-dom",
                    "selector",
                    context={"source": "manual"},
                ),
            )
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["id"] == "custom:orders"
    assert target["columns"] == [{"name": "amount", "dtype": "float"}]
    assert target["selectors"] == ["[data-orders-grid]"]
    assert target["selectionPolicy"]["context"] == {"source": "manual"}


def test_column_metadata_cannot_clobber_canonical_column_fields() -> None:
    lens = Lens(
        targets=[
            targets.dataframe(
                id="custom:orders",
                label="Orders",
                columns=[
                    targets.Column(
                        "amount",
                        "float",
                        metadata={"name": "wrong", "dtype": "wrong", "role": "metric"},
                    )
                ],
            )
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["columns"] == [
        {
            "name": "amount",
            "dtype": "float",
            "metadata": {"name": "wrong", "dtype": "wrong", "role": "metric"},
        }
    ]


@pytest.mark.parametrize(
    ("kind", "columns", "capability", "prefer"),
    [
        (
            "dataframe",
            [{"name": "region", "dtype": "str"}],
            ("columnarDom", True),
            ["columnar-dom", "selector"],
        ),
        ("media", [], ("media", True), ["media", "selector"]),
        ("document", [], ("document", True), ["document", "selector"]),
        ("data", [], ("data", True), ["selector"]),
        ("diagnostic", [], ("diagnostic", True), ["selector"]),
        ("layout", [], ("interactive", True), ["interactive", "selector"]),
        ("output", [], None, ["display-cell", "selector"]),
        ("object", [], None, ["selector"]),
    ],
)
def test_manual_target_kind_configures_selection_behavior(
    kind: str,
    columns: list[dict[str, str]],
    capability: tuple[str, bool] | None,
    prefer: list[str],
) -> None:
    lens = Lens(
        targets=[
            {
                "id": f"custom:{kind}",
                "label": kind,
                "kind": kind,
                "columns": columns,
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["kind"] == kind
    if capability is not None:
        name, enabled = capability
        assert target["capabilities"][name] is enabled
    assert target["selectionPolicy"]["prefer"] == prefer


def test_selection_policy_adds_interactive_and_dedupes_selector() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:ui",
                "label": "ui",
                "kind": "ui",
                "capabilities": {"interactive": True},
                "selectionPolicy": {
                    "prefer": ["selector", "interactive", "selector"],
                    "context": {"source": "manual"},
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["selectionPolicy"] == {
        "prefer": ["selector", "interactive"],
        "context": {"source": "manual"},
    }


def test_explicit_false_capability_overrides_default() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "columns": [{"name": "amount", "dtype": "float"}],
                "capabilities": {"columnarDom": False},
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["capabilities"]["columnarDom"] is False
    assert target["selectionPolicy"]["prefer"] == ["selector"]


def test_manual_target_extensions_do_not_clobber_canonical_fields() -> None:
    lens = Lens(
        targets=[
            targets.object(
                id="custom:object",
                label="Object",
                extensions={"kind": "dataframe", "family": "custom"},
            )
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["kind"] == "object"
    assert target["extensions"] == {"kind": "dataframe", "family": "custom"}


def test_manual_target_entity_output_and_extensions_match_wire_contract() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:output",
                "label": "output",
                "kind": "output",
                "entity": {"inspector": "custom"},
                "output": {"kind": "object", "custom": object()},
                "extensions": {"raw": object()},
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["entity"] == {"inspector": "custom", "family": "output"}
    assert target["output"] == {"kind": "object"}
    assert "custom" in target["extensions"]["output"]
    json.dumps(target)


def test_selection_model_defaults_to_column_units_with_cell_degradation() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "columns": [
                    {"name": "region", "dtype": "str"},
                    {"name": "revenue", "dtype": "int64"},
                ],
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets
    units = {
        (unit["kind"], unit["id"]): unit for unit in target["selectionModel"]["units"]
    }
    revenue = units[("column", "col:revenue")]
    cell = units[("cell", "cell")]

    assert target["selectionModel"]["defaultFallback"] == "column"
    assert revenue["match"] == {"column": "revenue"}
    assert revenue["data"] == {"column": "revenue", "columnDtype": "int64"}
    assert revenue["fallbackFor"] == [
        "cell",
        "summary-stat",
        "dtype-label",
        "body-cell",
        "grid-cell",
    ]
    assert cell["requires"] == ["rowId", "column"]
    assert cell["supported"] is False


def test_manual_selection_model_is_normalized() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "selectionModel": {
                    "defaultFallback": "column",
                    "units": [
                        {
                            "kind": "column",
                            "id": "col:revenue",
                            "label": "Revenue",
                            "fallbackFor": ["cell"],
                            "data": {"column": "revenue"},
                        }
                    ],
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets
    units = {
        (unit["kind"], unit["id"]): unit for unit in target["selectionModel"]["units"]
    }
    revenue = units[("column", "col:revenue")]

    assert target["selectionModel"]["defaultFallback"] == "column"
    assert revenue["label"] == "Revenue"
    assert revenue["fallbackFor"] == ["cell"]
    assert revenue["supported"] is True
    assert revenue["match"] == {"column": "revenue"}
    assert revenue["data"] == {"column": "revenue"}


def test_selection_unit_helpers_emit_resolver_hints() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "selectionModel": selection.Model(
                    units=[
                        selection.column("amount", dtype="float"),
                        selection.unit(
                            "segment",
                            id="segment:enterprise",
                            label="Enterprise segment",
                            granularity="group",
                            match={"column": "segment", "value": "enterprise"},
                            data={"segment": "enterprise"},
                        ),
                    ],
                    default_fallback="column",
                ),
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets
    units = {
        (unit["kind"], unit["id"]): unit for unit in target["selectionModel"]["units"]
    }
    amount = units[("column", "col:amount")]
    enterprise = units[("segment", "segment:enterprise")]

    assert amount["match"] == {"column": "amount"}
    assert amount["granularity"] == "group"
    assert enterprise["match"] == {
        "column": "segment",
        "value": "enterprise",
    }


def test_chart_part_metadata_accepts_valid_parts() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:chart",
                "label": "chart",
                "kind": "visualization",
                "chart": {
                    "library": "custom",
                    "parts": [
                        {"kind": "axis", "label": "x axis"},
                        {"kind": "mark", "label": "bars"},
                    ],
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert target["chart"]["parts"] == [
        {"kind": "axis", "label": "x axis"},
        {"kind": "mark", "label": "bars"},
    ]


def test_chart_part_metadata_moves_unknown_keys_to_extensions() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:chart",
                "label": "chart",
                "kind": "visualization",
                "chart": {
                    "library": "custom",
                    "parts": [{"kind": "axis", "label": "x axis", "foo": "bar"}],
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    part = target["chart"]["parts"][0]

    assert "foo" not in part
    assert part["extensions"]["foo"] == "bar"


def test_chart_metadata_normalization_drops_null_optional_fields() -> None:
    lens = Lens(
        targets=[
            {
                "id": "custom:chart",
                "label": "chart",
                "kind": "visualization",
                "chart": {
                    "library": "custom",
                    "mark": None,
                    "parts": [
                        {
                            "kind": "axis",
                            "label": "x axis",
                            "detail": None,
                        }
                    ],
                },
            }
        ],
        source=context.mapping({}),
    )
    [target] = lens.targets

    assert "mark" not in target["chart"]
    assert target["chart"]["parts"] == [{"kind": "axis", "label": "x axis"}]
