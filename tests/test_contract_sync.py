from __future__ import annotations

from pathlib import Path
from typing import get_args

from marimo_lens import selection
from marimo_lens._contract import (
    AGENT_ACTIVITY_KINDS,
    AGENT_ANNOTATION_STATUSES,
    AGENT_CELL_MARK_STATUSES,
    AGENT_FINISH_STATUSES,
    CAPABILITY_KEYS,
    CHART_PART_KINDS,
    SELECTION_GRANULARITIES,
    SELECTION_SURFACES,
    TARGET_KINDS,
)
from marimo_lens.inspectors.charts._metadata import VALID_CHART_PART_KINDS
from tests.support.typescript_literals import exported_string_arrays

ROOT = Path(__file__).resolve().parents[1]
TS_CONTRACT_ARRAYS = (
    "LENS_TARGET_KINDS",
    "CAPABILITY_KEYS",
    "SELECTION_SURFACES",
    "SELECTION_GRANULARITIES",
    "CHART_PART_KINDS",
    "AGENT_ACTIVITY_KINDS",
    "AGENT_CELL_MARK_STATUSES",
    "AGENT_ANNOTATION_STATUSES",
    "AGENT_FINISH_STATUSES",
)


def test_python_selection_literals_match_wire_contract() -> None:
    assert get_args(selection.SelectionSurface) == SELECTION_SURFACES
    assert get_args(selection.SelectionGranularity) == SELECTION_GRANULARITIES
    assert VALID_CHART_PART_KINDS == CHART_PART_KINDS


def test_frontend_contract_constants_match_python_wire_contract() -> None:
    contract = exported_string_arrays(
        ROOT / "js/selection/target-contract.ts",
        TS_CONTRACT_ARRAYS,
    )

    assert contract["LENS_TARGET_KINDS"] == TARGET_KINDS
    assert contract["CAPABILITY_KEYS"] == CAPABILITY_KEYS
    assert contract["SELECTION_SURFACES"] == SELECTION_SURFACES
    assert contract["SELECTION_GRANULARITIES"] == SELECTION_GRANULARITIES
    assert contract["CHART_PART_KINDS"] == CHART_PART_KINDS
    assert contract["AGENT_ACTIVITY_KINDS"] == AGENT_ACTIVITY_KINDS
    assert contract["AGENT_CELL_MARK_STATUSES"] == AGENT_CELL_MARK_STATUSES
    assert contract["AGENT_ANNOTATION_STATUSES"] == AGENT_ANNOTATION_STATUSES
    assert contract["AGENT_FINISH_STATUSES"] == AGENT_FINISH_STATUSES
