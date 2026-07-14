from __future__ import annotations

from marimo_lens.inspectors import ChartEntity
from marimo_lens.inspectors.charts.plotly import PlotlyChartAdapter


PlotlyFigure = type(
    "Figure",
    (),
    {
        "__module__": "plotly.graph_objs._figure",
        "to_plotly_json": lambda self: {
            "data": [
                {"type": "bar", "name": "Revenue"},
                {"type": "scatter"},
            ],
            "layout": {
                "xaxis": {"title": {"text": "Quarter"}},
                "yaxis": {"title": "Revenue"},
                "title": {"text": "Sales"},
                "showlegend": True,
            },
        },
    },
)


def test_plotly_adapter_generates_trace_axis_legend_and_title_parts() -> None:
    metadata = PlotlyChartAdapter().inspect(ChartEntity(PlotlyFigure()))

    assert metadata is not None
    parts = {
        (part["kind"], part["label"], part.get("detail")) for part in metadata["parts"]
    }

    assert metadata["library"] == "plotly"
    assert metadata["traceCount"] == 2
    assert ("trace", "Revenue", "bar") in parts
    assert ("axis", "x axis", "Quarter") in parts
    assert ("axis", "y axis", "Revenue") in parts
    assert ("legend", "legend", None) in parts
    assert ("title", "Sales", None) in parts


def test_plotly_adapter_ignores_charts_when_spec_cannot_be_read() -> None:
    class BrokenPlotlyFigure:
        __module__ = "plotly.graph_objs._figure"

        def to_plotly_json(self, **kwargs: object) -> dict[str, object]:
            del kwargs
            raise RuntimeError("broken plotly figure")

    assert PlotlyChartAdapter().inspect(ChartEntity(BrokenPlotlyFigure())) is None
