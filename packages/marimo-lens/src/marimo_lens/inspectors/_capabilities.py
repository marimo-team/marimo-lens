"""Capability helpers shared by built-in inspectors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def capabilities(
    *,
    columnar_dom: bool = False,
    columnar_grid: bool = False,
    visual_surface: bool = False,
    chart_part: bool = False,
    media: bool = False,
    document: bool = False,
    data: bool = False,
    diagnostic: bool = False,
    interactive: bool = False,
) -> dict[str, bool]:
    return {
        "columnarDom": columnar_dom,
        "columnarGrid": columnar_grid,
        "visualSurface": visual_surface,
        "chartPart": chart_part,
        "media": media,
        "document": document,
        "data": data,
        "diagnostic": diagnostic,
        "interactive": interactive,
    }


def selection_policy(
    *surfaces: str,
    context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    prefer = [surface for surface in surfaces if surface]
    prefer.append("selector")
    return {"prefer": list(dict.fromkeys(prefer)), "context": dict(context or {})}


def target_capabilities(
    kind: str,
    columns: Sequence[Mapping[str, Any]],
) -> dict[str, bool]:
    return capabilities(
        columnar_dom=bool(columns) or kind in {"dataframe", "table"},
        visual_surface=kind == "visualization",
        chart_part=kind == "visualization",
        media=kind == "media",
        document=kind == "document",
        data=kind == "data",
        diagnostic=kind == "diagnostic",
        interactive=kind in {"anywidget", "layout", "ui"},
    )
