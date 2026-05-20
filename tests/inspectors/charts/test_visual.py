from __future__ import annotations

from marimo_lens.inspectors import ChartEntity, ChartInspector
from marimo_lens.inspectors.charts.visual import VisualChartAdapter

from tests.support.sample_entities import lens_entity


def test_visual_adapter_accepts_svg_html_context() -> None:
    metadata = VisualChartAdapter().inspect(
        ChartEntity("<svg></svg>", is_svg_html=True)
    )

    assert metadata == {
        "library": "visual",
        "parts": [{"kind": "plot-area", "label": "visual"}],
    }


def test_svg_html_target_is_visualization() -> None:
    import marimo as mo

    chart = mo.Html(
        """
        <svg viewBox="0 0 240 160">
          <text x="24" y="24">Revenue by region</text>
          <rect x="40" y="80" width="32" height="52" data-region="North"></rect>
        </svg>
        """
    )
    metadata = ChartInspector().inspect(lens_entity("generic_svg_chart", chart))

    assert metadata is not None
    assert metadata["kind"] == "visualization"
    assert metadata["capabilities"]["visualSurface"] is True
    assert metadata["chart"]["library"] == "visual"
