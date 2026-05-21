from __future__ import annotations

import json
from typing import Any

import pytest

from marimo_lens import selection, targets
from marimo_lens.metadata import _normalize_targets

from tests.support.assertions import _capabilities


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
def test_normalize_targets_validates_manual_target_contract(
    target: dict[str, Any],
    match: str,
) -> None:
    with pytest.raises(ValueError, match=match):
        _normalize_targets([target])


def test_manual_target_context_is_synced_without_redaction() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )
    serialized = json.dumps(target, sort_keys=True)

    assert target["selectionPolicy"]["context"]["api_token"] == "manual-secret"
    assert "manual-bearer" in serialized
    assert "<redacted>" not in serialized


def test_typed_manual_target_builders_normalize_to_wire_contract() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["id"] == "custom:orders"
    assert target["columns"] == [{"name": "amount", "dtype": "float"}]
    assert target["selectors"] == ["[data-orders-grid]"]
    assert target["selectionPolicy"]["context"] == {"source": "manual"}


def test_column_metadata_cannot_clobber_canonical_column_fields() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["columns"] == [
        {
            "name": "amount",
            "dtype": "float",
            "metadata": {"name": "wrong", "dtype": "wrong", "role": "metric"},
        }
    ]


def test_manual_targets_accept_new_output_kinds() -> None:
    targets = _normalize_targets(
        [
            {"id": f"{kind}:demo", "label": kind, "kind": kind}
            for kind in (
                "media",
                "document",
                "data",
                "layout",
                "diagnostic",
                "output",
            )
        ]
    )

    assert [target["kind"] for target in targets] == [
        "media",
        "document",
        "data",
        "layout",
        "diagnostic",
        "output",
    ]
    assert targets[0]["capabilities"]["media"] is True
    assert targets[3]["capabilities"] == _capabilities(interactive=True)
    assert targets[5]["selectionPolicy"]["prefer"] == ["display-cell", "selector"]


@pytest.mark.parametrize(
    ("kind", "columns", "capabilities", "prefer"),
    [
        (
            "dataframe",
            [{"name": "region", "dtype": "str"}],
            _capabilities(columnarDom=True),
            ["columnar-dom", "selector"],
        ),
        ("media", [], _capabilities(media=True), ["media", "selector"]),
        ("document", [], _capabilities(document=True), ["document", "selector"]),
        ("data", [], _capabilities(data=True), ["selector"]),
        ("diagnostic", [], _capabilities(diagnostic=True), ["selector"]),
        ("layout", [], _capabilities(interactive=True), ["interactive", "selector"]),
        ("output", [], _capabilities(), ["display-cell", "selector"]),
        ("object", [], _capabilities(), ["selector"]),
    ],
)
def test_default_capabilities_and_selection_policy_matrix(
    kind: str,
    columns: list[dict[str, str]],
    capabilities: dict[str, bool],
    prefer: list[str],
) -> None:
    [target] = _normalize_targets(
        [
            {
                "id": f"custom:{kind}",
                "label": kind,
                "kind": kind,
                "columns": columns,
            }
        ]
    )

    assert target["capabilities"] == capabilities
    assert target["selectionPolicy"]["prefer"] == prefer


def test_selection_policy_adds_interactive_and_dedupes_selector() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["selectionPolicy"] == {
        "prefer": ["selector", "interactive"],
        "context": {"source": "manual"},
    }


def test_explicit_false_capability_overrides_default() -> None:
    [target] = _normalize_targets(
        [
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "columns": [{"name": "amount", "dtype": "float"}],
                "capabilities": {"columnarDom": False},
            }
        ]
    )

    assert target["capabilities"]["columnarDom"] is False
    assert target["selectionPolicy"]["prefer"] == ["selector"]


def test_manual_target_extensions_do_not_clobber_canonical_fields() -> None:
    [target] = _normalize_targets(
        [
            targets.object(
                id="custom:object",
                label="Object",
                extensions={"kind": "dataframe", "family": "custom"},
            )
        ]
    )

    assert target["kind"] == "object"
    assert target["extensions"] == {"kind": "dataframe", "family": "custom"}


def test_manual_target_entity_output_and_extensions_match_wire_contract() -> None:
    [target] = _normalize_targets(
        [
            {
                "id": "custom:output",
                "label": "output",
                "kind": "output",
                "entity": {"inspector": "custom"},
                "output": {"kind": "object", "custom": object()},
                "extensions": {"raw": object()},
            }
        ]
    )

    assert target["entity"] == {"inspector": "custom", "family": "output"}
    assert target["output"] == {"kind": "object"}
    assert "custom" in target["extensions"]["output"]
    json.dumps(target)


def test_selection_model_defaults_to_column_units_with_cell_degradation() -> None:
    [target] = _normalize_targets(
        [
            {
                "id": "custom:orders",
                "label": "orders",
                "kind": "dataframe",
                "columns": [
                    {"name": "region", "dtype": "str"},
                    {"name": "revenue", "dtype": "int64"},
                ],
            }
        ]
    )

    assert target["selectionModel"]["defaultFallback"] == "column"
    assert target["selectionModel"]["units"][1] == {
        "kind": "column",
        "id": "col:revenue",
        "label": "revenue",
        "granularity": "group",
        "selectors": [],
        "fallbackFor": [
            "cell",
            "summary-stat",
            "dtype-label",
            "body-cell",
            "grid-cell",
        ],
        "requires": [],
        "supported": True,
        "match": {"column": "revenue"},
        "data": {"column": "revenue", "columnDtype": "int64"},
    }
    assert target["selectionModel"]["units"][2] == {
        "kind": "cell",
        "id": "cell",
        "label": "cell",
        "granularity": "item",
        "requires": ["rowId", "column"],
        "selectors": [],
        "fallbackFor": [],
        "supported": False,
        "match": {},
        "data": {},
    }


def test_manual_selection_model_is_normalized() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["selectionModel"] == {
        "defaultFallback": "column",
        "units": [
            {
                "kind": "column",
                "id": "col:revenue",
                "label": "Revenue",
                "requires": [],
                "selectors": [],
                "fallbackFor": ["cell"],
                "supported": True,
                "match": {"column": "revenue"},
                "data": {"column": "revenue"},
            }
        ],
    }


def test_selection_unit_helpers_emit_resolver_hints() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["selectionModel"]["units"][0]["match"] == {"column": "amount"}
    assert target["selectionModel"]["units"][0]["granularity"] == "group"
    assert target["selectionModel"]["units"][1]["match"] == {
        "column": "segment",
        "value": "enterprise",
    }


def test_chart_part_metadata_accepts_valid_parts() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert target["chart"]["parts"] == [
        {"kind": "axis", "label": "x axis"},
        {"kind": "mark", "label": "bars"},
    ]


def test_chart_part_metadata_moves_unknown_keys_to_extensions() -> None:
    [target] = _normalize_targets(
        [
            {
                "id": "custom:chart",
                "label": "chart",
                "kind": "visualization",
                "chart": {
                    "library": "custom",
                    "parts": [{"kind": "axis", "label": "x axis", "foo": "bar"}],
                },
            }
        ]
    )

    part = target["chart"]["parts"][0]

    assert "foo" not in part
    assert part["extensions"]["foo"] == "bar"


def test_chart_metadata_normalization_drops_null_optional_fields() -> None:
    [target] = _normalize_targets(
        [
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
        ]
    )

    assert "mark" not in target["chart"]
    assert target["chart"]["parts"] == [{"kind": "axis", "label": "x axis"}]
